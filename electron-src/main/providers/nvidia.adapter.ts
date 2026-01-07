// NVIDIA NIM adapter

import OpenAI from 'openai';
import {
  BaseProviderAdapter, GenerateRequest, GenerateResponse, StreamChunk,
  ConnectionTestResult, NormalizedError, ProviderCapabilities,
} from './base.js';
import { modelCacheService } from '../services/model-cache.service.js';

export class NvidiaAdapter extends BaseProviderAdapter {
  readonly id = 'nvidia' as const;
  readonly displayName = 'NVIDIA NIM';

  readonly capabilities: ProviderCapabilities = {
    supportsStreaming: true,
    supportsSystemMessage: true,
    supportsFunctionCalling: true,
    supportsVision: true,
    maxContextTokens: 128000,
    defaultModel: 'meta/llama-3.1-70b-instruct',
    availableModels: [
      'meta/llama-3.1-70b-instruct', 'meta/llama-3.1-8b-instruct', 'meta/llama-3.2-3b-instruct', 'meta/llama-3.3-70b-instruct',
      'mistralai/mistral-large-2-instruct', 'mistralai/mixtral-8x22b-instruct-v0.1',
      'google/gemma-2-27b-it', 'google/gemma-2-9b-it',
      'microsoft/phi-3-medium-128k-instruct',
      'nvidia/llama-3.1-nemotron-70b-instruct',
      'qwen/qwen2.5-72b-instruct', 'qwen/qwen2.5-coder-32b-instruct',
    ],
  };

  private client(key: string): OpenAI {
    return new OpenAI({ apiKey: key, baseURL: 'https://integrate.api.nvidia.com/v1' });
  }

  async *generate(req: GenerateRequest, apiKey: string, signal?: AbortSignal): AsyncGenerator<StreamChunk, GenerateResponse, undefined> {
    const cli = this.client(apiKey);
    const model = req.model || await modelCacheService.getRandomModel(this.id, apiKey);
    const t0 = Date.now();

    let content = '';
    let promptTok = 0, compTok = 0;
    let finish: GenerateResponse['finishReason'] = 'stop';

    console.log('nvidia:', model);

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
      if (err.status === 401) return { type: 'auth', message: 'Invalid NVIDIA API key' };
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

export const nvidiaAdapter = new NvidiaAdapter();
