// Cloudflare Workers AI adapter - 10k neurons/day free
// Key format: "account_id:api_token"

import { BaseProviderAdapter, type GenerateRequest, type StreamChunk, type NormalizedError, type ProviderCapabilities, type ConnectionTestResult, type GenerateResponse } from './base.js';
import { providerUsageRepo } from '../database/repositories/index.js';

// neuron costs per model (rough estimates from cloudflare pricing)
const NEURON_COSTS: Record<string, { input: number; output: number }> = {
  '@cf/openai/gpt-oss-120b': { input: 0.5, output: 2.0 },
  '@cf/openai/gpt-oss-20b': { input: 0.1, output: 0.5 },
  '@cf/meta/llama-4-scout-17b-16e-instruct': { input: 0.2, output: 0.8 },
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast': { input: 0.3, output: 1.2 },
  '@cf/meta/llama-3.1-70b-instruct': { input: 0.3, output: 1.2 },
  '@cf/meta/llama-3.1-8b-instruct-fast': { input: 0.02, output: 0.08 },
  'default': { input: 0.01, output: 0.05 },
};

export class CloudflareAdapter extends BaseProviderAdapter {
  readonly id = 'cloudflare' as const;
  readonly displayName = 'Cloudflare Workers AI';
  readonly description = 'GPT-OSS, Llama, Granite, Mistral - 10k Neurons/day free';

  readonly capabilities: ProviderCapabilities = {
    supportsStreaming: true,
    supportsSystemMessage: true,
    supportsFunctionCalling: true,
    supportsVision: true,
    maxContextTokens: 131072,
    defaultModel: '@cf/meta/llama-3.1-8b-instruct-fast',
    availableModels: [
      '@cf/openai/gpt-oss-120b', '@cf/openai/gpt-oss-20b',
      '@cf/meta/llama-4-scout-17b-16e-instruct', '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
      '@cf/meta/llama-3.1-8b-instruct-fast', '@cf/meta/llama-3.1-70b-instruct',
      '@cf/meta/llama-3.1-8b-instruct', '@cf/meta/llama-3-8b-instruct',
      '@cf/meta/llama-3.2-3b-instruct', '@cf/meta/llama-3.2-1b-instruct',
      '@cf/ibm/granite-4.0-h-micro',
      '@cf/mistral/mistral-7b-instruct-v0.2', '@cf/mistral/mistral-7b-instruct-v0.1',
      '@cf/qwen/qwen2.5-coder-32b-instruct', '@cf/qwen/qwen1.5-14b-chat-awq',
      '@cf/google/gemma-7b-it', '@cf/microsoft/phi-2',
    ],
  };

  private parseKey(key: string): { accountId: string; token: string } | null {
    const [accountId, token] = key.split(':');
    if (!accountId || !token) {
      console.error('cloudflare: bad key format, need "account_id:api_token"');
      return null;
    }
    return { accountId, token };
  }

  async testConnection(apiKey: string): Promise<ConnectionTestResult> {
    const t0 = Date.now();
    const creds = this.parseKey(apiKey);
    
    if (!creds) {
      return { success: false, error: { type: 'auth', message: 'Key must be "account_id:api_token"' } };
    }

    try {
      const resp = await fetch('https://api.cloudflare.com/client/v4/user/tokens/verify', {
        headers: { 'Authorization': `Bearer ${creds.token}` },
      });

      const latency = Date.now() - t0;
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({})) as { errors?: Array<{ message: string }> };
        return { success: false, error: { type: 'auth', message: data.errors?.[0]?.message || `HTTP ${resp.status}` }, latencyMs: latency };
      }

      const data = await resp.json() as { success?: boolean };
      if (!data.success) {
        return { success: false, error: { type: 'auth', message: 'Token verify failed' }, latencyMs: latency };
      }

      return { success: true, latencyMs: latency };
    } catch (err) {
      return { success: false, error: { type: 'network', message: err instanceof Error ? err.message : 'Connection failed' }, latencyMs: Date.now() - t0 };
    }
  }

  private estimateNeurons(model: string, inTok: number, outTok: number): number {
    const c = NEURON_COSTS[model] || NEURON_COSTS['default'];
    return Math.ceil(inTok * c.input + outTok * c.output);
  }

  private checkLimit(): { ok: boolean; current: number; limit: number } {
    const s = providerUsageRepo.getUsageStatus('cloudflare');
    return { ok: !s.isLocked, current: s.currentUsage.neurons, limit: s.limits.neurons };
  }

  async *generate(req: GenerateRequest, apiKey: string): AsyncGenerator<StreamChunk, GenerateResponse, undefined> {
    const limit = this.checkLimit();
    if (!limit.ok) {
      console.warn(`cloudflare: limit reached ${limit.current}/${limit.limit}`);
      yield { type: 'error', error: { type: 'rate_limit', message: `Daily limit reached (${limit.current}/${limit.limit} Neurons)`, retryAfterMs: this.msUntilReset() } };
      return { content: '', model: this.capabilities.defaultModel, usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }, finishReason: 'error', latencyMs: 0 };
    }

    const creds = this.parseKey(apiKey);
    if (!creds) {
      yield { type: 'error', error: { type: 'auth', message: 'Key must be "account_id:api_token"' } };
      return { content: '', model: this.capabilities.defaultModel, usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }, finishReason: 'error', latencyMs: 0 };
    }

    const model = req.model || this.selectRandomModel();
    const t0 = Date.now();
    let content = '';
    const inTok = Math.ceil(req.messages.reduce((s, m) => s + m.content.length, 0) / 4);

    try {
      const url = `https://api.cloudflare.com/client/v4/accounts/${creds.accountId}/ai/run/${model}`;
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${creds.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: req.messages, stream: true, max_tokens: req.maxTokens || 2048 }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({})) as { errors?: Array<{ message?: string }> };
        yield { type: 'error', error: this.mapErr(resp.status, err) };
        return { content: '', model, usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }, finishReason: 'error', latencyMs: Date.now() - t0 };
      }

      const ctype = resp.headers.get('content-type') || '';
      
      if (ctype.includes('text/event-stream')) {
        const reader = resp.body?.getReader();
        if (!reader) throw new Error('no body');
        const dec = new TextDecoder();
        let buf = '';

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
              if (p.response) { content += p.response; yield { type: 'delta', delta: p.response }; }
            } catch { /* bad json */ }
          }
        }

        const outTok = Math.ceil(content.length / 4);
        yield { type: 'done', usage: { promptTokens: 0, completionTokens: outTok, totalTokens: outTok }, model, finishReason: 'stop' };
      } else {
        const data = await resp.json() as { result?: { response?: string }; success?: boolean; errors?: Array<{ message: string }> };
        if (!data.success || !data.result?.response) {
          yield { type: 'error', error: { type: 'unknown', message: data.errors?.[0]?.message || 'Unknown error' } };
          return { content: '', model, usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }, finishReason: 'error', latencyMs: Date.now() - t0 };
        }
        content = data.result.response;
        yield { type: 'delta', delta: content };
        yield { type: 'done', usage: { promptTokens: 0, completionTokens: Math.ceil(content.length / 4), totalTokens: Math.ceil(content.length / 4) }, model, finishReason: 'stop' };
      }

      const outTok = Math.ceil(content.length / 4);
      const neurons = this.estimateNeurons(model, inTok, outTok);
      providerUsageRepo.recordUsage('cloudflare', { requests: 1, tokens: inTok + outTok, neurons });
      console.log(`cloudflare: ~${neurons} neurons (${inTok} in, ${outTok} out)`);

      return { content, model, usage: { promptTokens: inTok, completionTokens: outTok, totalTokens: inTok + outTok }, finishReason: 'stop', latencyMs: Date.now() - t0 };
    } catch (err) {
      console.error('cloudflare:', err);
      yield { type: 'error', error: { type: 'network', message: err instanceof Error ? err.message : 'Network error' } };
      return { content, model, usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }, finishReason: 'error', latencyMs: Date.now() - t0 };
    }
  }

  private msUntilReset(): number {
    const now = new Date();
    const tmrw = new Date(now);
    tmrw.setUTCDate(tmrw.getUTCDate() + 1);
    tmrw.setUTCHours(0, 0, 0, 0);
    return tmrw.getTime() - now.getTime();
  }

  getUsageStatus() {
    const s = providerUsageRepo.getUsageStatus('cloudflare');
    return { currentNeurons: s.currentUsage.neurons, limit: s.limits.neurons, percentUsed: s.percentUsed.neurons, isLocked: s.isLocked, resetsAt: s.resetsAt };
  }

  private mapErr(status: number, data: { errors?: Array<{ message?: string }> }): NormalizedError {
    const msg = data?.errors?.[0]?.message || `HTTP ${status}`;
    if (status === 401 || status === 403) return { type: 'auth', message: `Auth failed: ${msg}` };
    if (status === 429) return { type: 'rate_limit', message: `Rate limit: ${msg}`, retryAfterMs: 60000 };
    if (status >= 500) return { type: 'server_error', statusCode: status, message: msg };
    return { type: 'unknown', message: msg };
  }
}

export const cloudflareAdapter = new CloudflareAdapter();
