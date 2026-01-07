// Together AI adapter - fast open-source inference

import OpenAI from 'openai';
import {
  BaseProviderAdapter, GenerateRequest, GenerateResponse, StreamChunk,
  ConnectionTestResult, NormalizedError, ProviderCapabilities,
} from './base.js';
import { modelCacheService } from '../services/model-cache.service.js';

export class TogetherAdapter extends BaseProviderAdapter {
  readonly id = 'together' as const;
  readonly displayName = 'Together AI';

  readonly capabilities: ProviderCapabilities = {
    supportsStreaming: true,
    supportsSystemMessage: true,
    supportsFunctionCalling: true,
    supportsVision: true,
    maxContextTokens: 131072,
    defaultModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    availableModels: [
      'meta-llama/Llama-3.3-70B-Instruct-Turbo', 'meta-llama/Meta-Llama-3.1-405B-Instruct-Turbo',
      'meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo', 'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo',
      'mistralai/Mixtral-8x22B-Instruct-v0.1', 'mistralai/Mixtral-8x7B-Instruct-v0.1',
      'Qwen/Qwen2.5-72B-Instruct-Turbo', 'Qwen/Qwen2.5-7B-Instruct-Turbo',
      'deepseek-ai/DeepSeek-R1-Distill-Llama-70B', 'google/gemma-2-27b-it',
    ],
  };

  private client(key: string): OpenAI {
    return new OpenAI({ apiKey: key, baseURL: 'https://api.together.xyz/v1' });
  }

  async *generate(req: GenerateRequest, apiKey: string, signal?: AbortSignal): AsyncGenerator<StreamChunk, GenerateResponse, undefined> {
    const cli = this.client(apiKey);
    const model = req.model || await modelCacheService.getRandomModel(this.id, apiKey);
    const t0 = Date.now();

    let content = '';
    let promptTok = 0, compTok = 0;
    let finish: GenerateResponse['finishReason'] = 'stop';

    console.log('together:', model);

    try {
      const stream = await cli.chat.completions.create({
        model,
        messages: req.messages.map(m => ({ role: m.role, content: m.content })),
        max_tokens: req.maxTokens,
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
      if (err.status === 401) return { type: 'auth', message: 'Invalid Together AI API key' };
      if (err.status === 402) return { type: 'billing', message: 'Together AI: add credits' };
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

export const togetherAdapter = new TogetherAdapter();
