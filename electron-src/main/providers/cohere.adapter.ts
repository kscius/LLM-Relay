// Cohere adapter - Command R+/R

import {
  BaseProviderAdapter, GenerateRequest, GenerateResponse, StreamChunk,
  ConnectionTestResult, NormalizedError, ProviderCapabilities, ChatMessage,
} from './base.js';
import { modelCacheService } from '../services/model-cache.service.js';

class CohereAPIError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'CohereAPIError';
  }
}

export class CohereAdapter extends BaseProviderAdapter {
  readonly id = 'cohere' as const;
  readonly displayName = 'Cohere';

  readonly capabilities: ProviderCapabilities = {
    supportsStreaming: true,
    supportsSystemMessage: true,
    supportsFunctionCalling: true,
    supportsVision: false,
    maxContextTokens: 128000,
    defaultModel: 'command-r-plus',
    availableModels: ['command-r-plus', 'command-r', 'command', 'command-light'],
  };

  private baseUrl = 'https://api.cohere.com/v2';

  async *generate(req: GenerateRequest, apiKey: string, signal?: AbortSignal): AsyncGenerator<StreamChunk, GenerateResponse, undefined> {
    const model = req.model || await modelCacheService.getRandomModel(this.id, apiKey);
    const t0 = Date.now();

    let content = '';
    let promptTok = 0, compTok = 0;
    let finish: GenerateResponse['finishReason'] = 'stop';

    console.log('cohere:', model);

    try {
      const resp = await fetch(`${this.baseUrl}/chat`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream',
        },
        body: JSON.stringify({
          model,
          messages: this.convertMsgs(req.messages),
          max_tokens: req.maxTokens,
          temperature: req.temperature,
          stop_sequences: req.stopSequences,
          stream: true,
        }),
        signal,
      });

      if (!resp.ok) {
        throw new CohereAPIError(resp.status, await resp.text());
      }

      const reader = resp.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let buf = '';

      while (true) {
        if (signal?.aborted) { reader.cancel(); break; }
        const { done, value } = await reader.read();
        if (done) break;

        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim() || !line.startsWith('data: ')) continue;
          const json = line.slice(6);
          if (json === '[DONE]') continue;

          try {
            const data = JSON.parse(json);
            if (data.type === 'content-delta' && data.delta?.message?.content?.text) {
              const delta = data.delta.message.content.text;
              content += delta;
              yield { type: 'delta', delta };
            }
            if (data.type === 'message-end') {
              if (data.delta?.finish_reason) finish = this.mapFinish(data.delta.finish_reason);
              if (data.delta?.usage) {
                promptTok = data.delta.usage.billed_units?.input_tokens || 0;
                compTok = data.delta.usage.billed_units?.output_tokens || 0;
              }
            }
          } catch { /* skip bad json */ }
        }
      }

      const latency = Date.now() - t0;
      yield {
        type: 'done',
        usage: { promptTokens: promptTok, completionTokens: compTok, totalTokens: promptTok + compTok },
        model, finishReason: finish,
      };

      return {
        content, model,
        usage: { promptTokens: promptTok, completionTokens: compTok, totalTokens: promptTok + compTok },
        finishReason: finish, latencyMs: latency,
      };
    } catch (err) {
      const norm = this.normalizeError(err);
      yield { type: 'error', error: norm };
      throw err;
    }
  }

  async testConnection(apiKey: string): Promise<ConnectionTestResult> {
    const t0 = Date.now();
    try {
      const resp = await fetch(`${this.baseUrl}/models`, { headers: { 'Authorization': `Bearer ${apiKey}` } });
      if (!resp.ok) throw new CohereAPIError(resp.status, await resp.text());
      return { success: true, latencyMs: Date.now() - t0 };
    } catch (err) {
      return { success: false, error: this.normalizeError(err), latencyMs: Date.now() - t0 };
    }
  }

  normalizeError(err: unknown, status?: number): NormalizedError {
    if (err instanceof CohereAPIError) {
      if (err.status === 401) return { type: 'auth', message: 'Invalid Cohere API key' };
      if (err.status === 429) return { type: 'rate_limit', message: err.message };
      if (err.status >= 500) return { type: 'server_error', statusCode: err.status, message: err.message };
      return { type: 'unknown', message: err.message };
    }
    return super.normalizeError(err, status);
  }

  private convertMsgs(msgs: ChatMessage[]): Array<{ role: string; content: string }> {
    return msgs.map(m => ({
      role: m.role === 'assistant' ? 'assistant' : m.role === 'system' ? 'system' : 'user',
      content: m.content,
    }));
  }

  private mapFinish(r: string): GenerateResponse['finishReason'] {
    if (r === 'MAX_TOKENS') return 'length';
    return 'stop';
  }
}

export const cohereAdapter = new CohereAdapter();

