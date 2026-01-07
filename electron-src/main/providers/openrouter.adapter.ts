// OpenRouter adapter - 50 req/day, 20 req/min free
// Free models end with :free

import { BaseProviderAdapter, type GenerateRequest, type StreamChunk, type NormalizedError, type ProviderCapabilities, type ConnectionTestResult, type GenerateResponse } from './base.js';
import { providerUsageRepo } from '../database/repositories/index.js';

const BASE = 'https://openrouter.ai/api/v1';

// minute-based rate limit (resets every 60s)
let minReqs = 0;
let minReset = Date.now() + 60000;

export class OpenRouterAdapter extends BaseProviderAdapter {
  readonly id = 'openrouter' as const;
  readonly displayName = 'OpenRouter';
  readonly description = 'Llama 3.1, Gemma 3, Qwen3 :free (50 req/day)';

  readonly capabilities: ProviderCapabilities = {
    supportsStreaming: true,
    supportsSystemMessage: true,
    supportsFunctionCalling: true,
    supportsVision: true,
    maxContextTokens: 131072,
    defaultModel: 'meta-llama/llama-3.1-8b-instruct:free',
    availableModels: [
      'meta-llama/llama-3.1-8b-instruct:free', 'meta-llama/llama-3.2-3b-instruct:free', 'meta-llama/llama-3.2-1b-instruct:free',
      'google/gemma-3-4b-it:free', 'google/gemma-3-12b-it:free', 'google/gemma-3-27b-it:free', 'google/gemma-2-9b-it:free',
      'qwen/qwen3-8b:free', 'qwen/qwen3-4b:free', 'qwen/qwen-2.5-7b-instruct:free',
      'microsoft/phi-3-mini-128k-instruct:free', 'mistralai/mistral-7b-instruct:free',
      'deepseek/deepseek-r1-0528:free', 'openchat/openchat-7b:free',
    ],
  };

  private checkLimits(): { ok: boolean; err?: string; retryMs?: number } {
    const now = Date.now();
    if (now >= minReset) { minReqs = 0; minReset = now + 60000; }
    if (minReqs >= 20) return { ok: false, err: `20 req/min exceeded, wait ${Math.ceil((minReset - now) / 1000)}s`, retryMs: minReset - now };
    
    const s = providerUsageRepo.getUsageStatus('openrouter');
    if (s.limits.requests > 0 && s.currentUsage.requests >= s.limits.requests) {
      return { ok: false, err: `Daily limit (${s.currentUsage.requests}/${s.limits.requests}). Resets midnight UTC.`, retryMs: this.msUntilReset() };
    }
    return { ok: true };
  }

  private msUntilReset(): number {
    const now = new Date();
    const tmrw = new Date(now);
    tmrw.setUTCDate(tmrw.getUTCDate() + 1);
    tmrw.setUTCHours(0, 0, 0, 0);
    return tmrw.getTime() - now.getTime();
  }

  async testConnection(apiKey: string): Promise<ConnectionTestResult> {
    const t0 = Date.now();
    try {
      const resp = await fetch(`${BASE}/auth/key`, { headers: { 'Authorization': `Bearer ${apiKey}` } });
      const latency = Date.now() - t0;
      if (!resp.ok) return { success: false, error: { type: 'auth', message: `HTTP ${resp.status}` }, latencyMs: latency };
      await resp.json();
      return { success: true, latencyMs: latency };
    } catch (err) {
      return { success: false, error: { type: 'network', message: err instanceof Error ? err.message : 'Failed' }, latencyMs: Date.now() - t0 };
    }
  }

  async *generate(req: GenerateRequest, apiKey: string): AsyncGenerator<StreamChunk, GenerateResponse, undefined> {
    const check = this.checkLimits();
    if (!check.ok) {
      yield { type: 'error', error: { type: 'rate_limit', message: check.err!, retryAfterMs: check.retryMs } };
      return { content: '', model: this.capabilities.defaultModel, usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }, finishReason: 'error', latencyMs: 0 };
    }

    minReqs++;
    const model = req.model || this.selectRandomModel();
    const t0 = Date.now();
    let content = '';

    try {
      const resp = await fetch(`${BASE}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://llm-relay.app',
          'X-Title': 'LLM Relay',
        },
        body: JSON.stringify({
          model,
          messages: req.messages.map(m => ({ role: m.role, content: m.content })),
          stream: true,
          max_tokens: req.maxTokens || 2048,
          temperature: req.temperature,
        }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({})) as { error?: { message?: string } };
        yield { type: 'error', error: this.mapErr(resp.status, err) };
        return { content: '', model, usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }, finishReason: 'error', latencyMs: Date.now() - t0 };
      }

      const reader = resp.body?.getReader();
      if (!reader) throw new Error('no body');

      const dec = new TextDecoder();
      let buf = '';
      let promptTok = 0, compTok = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const d = line.slice(6).trim();
          if (d === '[DONE]') continue;
          try {
            const p = JSON.parse(d);
            const delta = p.choices?.[0]?.delta?.content || '';
            if (delta) { content += delta; yield { type: 'delta', delta }; }
            if (p.usage) { promptTok = p.usage.prompt_tokens || 0; compTok = p.usage.completion_tokens || 0; }
          } catch { /* bad json */ }
        }
      }

      providerUsageRepo.recordUsage('openrouter', { requests: 1, tokens: promptTok + compTok });
      console.log(`openrouter: 1 req, ${promptTok + compTok} tokens`);

      yield { type: 'done', usage: { promptTokens: promptTok, completionTokens: compTok, totalTokens: promptTok + compTok }, model, finishReason: 'stop' };
      return { content, model, usage: { promptTokens: promptTok, completionTokens: compTok, totalTokens: promptTok + compTok }, finishReason: 'stop', latencyMs: Date.now() - t0 };
    } catch (err) {
      console.error('openrouter:', err);
      yield { type: 'error', error: { type: 'network', message: err instanceof Error ? err.message : 'Network error' } };
      return { content, model, usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }, finishReason: 'error', latencyMs: Date.now() - t0 };
    }
  }

  getUsageStatus() {
    const s = providerUsageRepo.getUsageStatus('openrouter');
    return { dailyRequests: s.currentUsage.requests, dailyLimit: s.limits.requests, minuteRequests: minReqs, minuteLimit: 20, isLocked: s.isLocked || minReqs >= 20 };
  }

  private mapErr(status: number, data: { error?: { message?: string } }): NormalizedError {
    const msg = data?.error?.message || `HTTP ${status}`;
    if (status === 401 || status === 403) return { type: 'auth', message: `Auth failed: ${msg}` };
    if (status === 402) return { type: 'rate_limit', message: `Payment required: ${msg}`, retryAfterMs: 0 };
    if (status === 429) return { type: 'rate_limit', message: `Rate limit: ${msg}`, retryAfterMs: 60000 };
    if (status >= 500) return { type: 'server_error', statusCode: status, message: msg };
    return { type: 'unknown', message: msg };
  }
}

export const openrouterAdapter = new OpenRouterAdapter();
