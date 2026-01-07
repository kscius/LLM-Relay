// Cerebras adapter - super fast inference

import OpenAI from 'openai';
import {
  BaseProviderAdapter, GenerateRequest, GenerateResponse, StreamChunk,
  ConnectionTestResult, NormalizedError, ProviderCapabilities,
} from './base.js';
import { modelCacheService } from '../services/model-cache.service.js';

export class CerebrasAdapter extends BaseProviderAdapter {
  readonly id = 'cerebras' as const;
  readonly displayName = 'Cerebras';

  readonly capabilities: ProviderCapabilities = {
    supportsStreaming: true,
    supportsSystemMessage: true,
    supportsFunctionCalling: false,
    supportsVision: false,
    maxContextTokens: 128000,
    defaultModel: 'llama3.1-70b',
    availableModels: ['llama3.1-70b', 'llama3.1-8b', 'llama-3.3-70b'],
  };

  private client(key: string): OpenAI {
    return new OpenAI({ apiKey: key, baseURL: 'https://api.cerebras.ai/v1' });
  }

  async *generate(req: GenerateRequest, apiKey: string, signal?: AbortSignal): AsyncGenerator<StreamChunk, GenerateResponse, undefined> {
    const cli = this.client(apiKey);
    const model = req.model || await modelCacheService.getRandomModel(this.id, apiKey);
    const t0 = Date.now();

    let content = '';
    let promptTok = 0, compTok = 0;
    let finish: GenerateResponse['finishReason'] = 'stop';

    console.log('cerebras:', model);

    try {
      const stream = await cli.chat.completions.create({
        model,
        messages: req.messages.map(m => ({ role: m.role, content: m.content })),
        max_tokens: req.maxTokens || 4096,
        temperature: req.temperature,
        stop: req.stopSequences,
        stream: true,
      }, { signal });

      for await (const chunk of stream) {
        if (signal?.aborted) break;
        const choice = chunk.choices[0];
        if (choice?.delta?.content) {
          content += choice.delta.content;
          yield { type: 'delta', delta: choice.delta.content };
        }
        if (choice?.finish_reason) finish = this.mapFinish(choice.finish_reason);
        if (chunk.usage) {
          promptTok = chunk.usage.prompt_tokens;
          compTok = chunk.usage.completion_tokens;
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
      await this.client(apiKey).models.list();
      return { success: true, latencyMs: Date.now() - t0 };
    } catch (err) {
      return { success: false, error: this.normalizeError(err), latencyMs: Date.now() - t0 };
    }
  }

  normalizeError(err: unknown, status?: number): NormalizedError {
    if (err instanceof OpenAI.APIError) {
      if (err.status === 401) return { type: 'auth', message: 'Invalid Cerebras API key' };
      if (err.status === 429) {
        const retry = err.headers?.['retry-after'];
        return { type: 'rate_limit', retryAfterMs: retry ? parseInt(retry, 10) * 1000 : undefined, message: err.message };
      }
      if (err.status && err.status >= 500) return { type: 'server_error', statusCode: err.status, message: err.message };
      return { type: 'unknown', message: err.message };
    }
    return super.normalizeError(err, status);
  }

  private mapFinish(r: string): GenerateResponse['finishReason'] {
    if (r === 'length') return 'length';
    if (r === 'content_filter') return 'content_filter';
    return 'stop';
  }
}

export const cerebrasAdapter = new CerebrasAdapter();
