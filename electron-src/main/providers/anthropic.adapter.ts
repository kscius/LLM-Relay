// Anthropic adapter - Claude models

import Anthropic from '@anthropic-ai/sdk';
import {
  BaseProviderAdapter, GenerateRequest, GenerateResponse, StreamChunk,
  ConnectionTestResult, NormalizedError, ProviderCapabilities,
} from './base.js';
import { modelCacheService } from '../services/model-cache.service.js';

export class AnthropicAdapter extends BaseProviderAdapter {
  readonly id = 'anthropic' as const;
  readonly displayName = 'Anthropic';

  readonly capabilities: ProviderCapabilities = {
    supportsStreaming: true,
    supportsSystemMessage: true,
    supportsFunctionCalling: true,
    supportsVision: true,
    maxContextTokens: 200000,
    defaultModel: 'claude-sonnet-4-20250514',
    availableModels: [
      'claude-sonnet-4-20250514', 'claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022',
      'claude-3-opus-20240229', 'claude-3-haiku-20240307',
    ],
  };

  private client(key: string): Anthropic {
    return new Anthropic({ apiKey: key });
  }

  async *generate(req: GenerateRequest, apiKey: string, signal?: AbortSignal): AsyncGenerator<StreamChunk, GenerateResponse, undefined> {
    const cli = this.client(apiKey);
    const model = req.model || await modelCacheService.getRandomModel(this.id, apiKey);
    const t0 = Date.now();

    let content = '';
    let promptTok = 0, compTok = 0;
    let finish: GenerateResponse['finishReason'] = 'stop';

    console.log('anthropic:', model);

    const sysMsg = req.messages.find(m => m.role === 'system');
    const msgs = req.messages.filter(m => m.role !== 'system');

    try {
      const stream = cli.messages.stream({
        model,
        system: sysMsg?.content,
        messages: msgs.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
        max_tokens: req.maxTokens || 4096,
        temperature: req.temperature,
        stop_sequences: req.stopSequences,
      }, { signal });

      for await (const ev of stream) {
        if (signal?.aborted) break;

        if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') {
          content += ev.delta.text;
          yield { type: 'delta', delta: ev.delta.text };
        }
        if (ev.type === 'message_delta' && ev.usage) {
          compTok = ev.usage.output_tokens;
        }
      }

      const final = await stream.finalMessage();
      promptTok = final.usage.input_tokens;
      compTok = final.usage.output_tokens;
      finish = this.mapStop(final.stop_reason);

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
      // no models.list, make minimal call
      await this.client(apiKey).messages.create({
        model: 'claude-3-haiku-20240307',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'Hi' }],
      });
      return { success: true, latencyMs: Date.now() - t0 };
    } catch (err) {
      // 529 = overloaded but key valid
      if (err instanceof Anthropic.APIError && err.status === 529) {
        return { success: true, latencyMs: Date.now() - t0 };
      }
      return { success: false, error: this.normalizeError(err), latencyMs: Date.now() - t0 };
    }
  }

  normalizeError(err: unknown, status?: number): NormalizedError {
    if (err instanceof Anthropic.APIError) {
      if (err.status === 401) return { type: 'auth', message: 'Invalid Anthropic API key' };
      if (err.status === 402 || err.status === 403) return { type: 'billing', message: 'Anthropic billing issue' };
      if (err.status === 429) return { type: 'rate_limit', message: err.message };
      if (err.status === 529) return { type: 'server_error', statusCode: 529, message: 'Anthropic overloaded' };
      if (err.status && err.status >= 500) return { type: 'server_error', statusCode: err.status, message: err.message };
      return { type: 'unknown', message: err.message };
    }
    return super.normalizeError(err, status);
  }

  private mapStop(r: string | null): GenerateResponse['finishReason'] {
    if (r === 'max_tokens') return 'length';
    return 'stop';
  }
}

export const anthropicAdapter = new AnthropicAdapter();
