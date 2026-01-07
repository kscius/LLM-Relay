// Ollama adapter - local models
// Pass URL as "api key" (e.g., http://localhost:11434)

import {
  BaseProviderAdapter, type ProviderId, type ProviderCapabilities,
  type GenerateRequest, type GenerateResponse, type StreamChunk,
  type ConnectionTestResult, type NormalizedError,
} from './base.js';

const DEFAULT_URL = 'http://localhost:11434';

const MODELS = [
  'llama3.2:latest', 'llama3.1:latest', 'llama3:latest',
  'mistral:latest', 'mixtral:latest', 'codellama:latest',
  'phi3:latest', 'gemma2:latest', 'qwen2.5:latest',
];

export class OllamaAdapter extends BaseProviderAdapter {
  readonly id: ProviderId = 'ollama' as ProviderId;
  readonly displayName = 'Ollama (Local)';
  readonly capabilities: ProviderCapabilities = {
    supportsStreaming: true,
    supportsSystemMessage: true,
    supportsFunctionCalling: false,
    supportsVision: false,
    maxContextTokens: 128000,
    defaultModel: 'llama3.2:latest',
    availableModels: MODELS,
  };

  private url(key: string): string {
    return key?.startsWith('http') ? key.replace(/\/$/, '') : DEFAULT_URL;
  }

  async testConnection(apiKey: string): Promise<ConnectionTestResult> {
    const base = this.url(apiKey);
    const t0 = Date.now();

    try {
      const resp = await fetch(`${base}/api/tags`);
      if (!resp.ok) throw new Error(`Ollama returned ${resp.status}`);
      
      const data = await resp.json() as { models?: Array<{ name: string }> };
      if (!data.models) {
        return { success: false, error: { type: 'server_error', message: 'No models. Run: ollama pull llama3.2' }, latencyMs: Date.now() - t0 };
      }

      if (data.models.length) {
        this.capabilities.availableModels = data.models.map(m => m.name);
        this.capabilities.defaultModel = data.models[0].name;
      }

      return { success: true, latencyMs: Date.now() - t0 };
    } catch (err) {
      return { success: false, error: this.normalizeError(err), latencyMs: Date.now() - t0 };
    }
  }

  async *generate(req: GenerateRequest, apiKey: string, signal?: AbortSignal): AsyncGenerator<StreamChunk, GenerateResponse, undefined> {
    const base = this.url(apiKey);
    const model = req.model || this.capabilities.defaultModel;
    const t0 = Date.now();

    let content = '';
    let promptTok = 0, compTok = 0;

    try {
      const resp = await fetch(`${base}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model, messages: req.messages, stream: true,
          max_tokens: req.maxTokens, temperature: req.temperature,
        }),
        signal,
      });

      if (!resp.ok) {
        const txt = await resp.text();
        throw new Error(`Ollama: ${resp.status} ${txt}`);
      }

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
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;
          const d = trimmed.slice(6);
          if (d === '[DONE]') continue;

          try {
            const p = JSON.parse(d) as { choices?: Array<{ delta?: { content?: string }; finish_reason?: string }>; usage?: { prompt_tokens?: number; completion_tokens?: number } };
            const delta = p.choices?.[0]?.delta?.content;
            if (delta) { content += delta; yield { type: 'delta', delta }; }
            if (p.usage) { promptTok = p.usage.prompt_tokens || 0; compTok = p.usage.completion_tokens || 0; }
            if (p.choices?.[0]?.finish_reason) break;
          } catch { /* bad chunk */ }
        }
      }

      const latency = Date.now() - t0;
      yield { type: 'done', usage: { promptTokens: promptTok, completionTokens: compTok, totalTokens: promptTok + compTok }, model, finishReason: 'stop' };
      return { content, model, usage: { promptTokens: promptTok, completionTokens: compTok, totalTokens: promptTok + compTok }, finishReason: 'stop', latencyMs: latency };
    } catch (err) {
      const norm = this.normalizeError(err);
      yield { type: 'error', error: norm };
      return { content, model, usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }, finishReason: 'error', latencyMs: Date.now() - t0 };
    }
  }

  normalizeError(err: unknown, status?: number): NormalizedError {
    if (err instanceof Error) {
      const msg = err.message.toLowerCase();
      if (msg.includes('econnrefused') || msg.includes('network') || msg.includes('fetch')) {
        return { type: 'network', message: 'Cannot connect to Ollama. Is it running?' };
      }
      if (msg.includes('model') && msg.includes('not found')) {
        return { type: 'unknown', message: `Model not found. Run: ollama pull ${this.capabilities.defaultModel}` };
      }
    }
    return super.normalizeError(err, status);
  }
}

export const ollamaAdapter = new OllamaAdapter();
