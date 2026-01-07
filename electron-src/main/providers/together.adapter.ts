import OpenAI from 'openai';
import {
  BaseProviderAdapter,
  GenerateRequest,
  GenerateResponse,
  StreamChunk,
  ConnectionTestResult,
  NormalizedError,
  ProviderCapabilities,
} from './base.js';
import { modelCacheService } from '../services/model-cache.service.js';

/**
 * Together AI Provider Adapter
 * 
 * Fast inference platform for open-source models.
 * Uses OpenAI-compatible API. Supports Llama 3.3, Mixtral, Qwen, and more.
 */
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
      'meta-llama/Llama-3.3-70B-Instruct-Turbo',
      'meta-llama/Meta-Llama-3.1-405B-Instruct-Turbo',
      'meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo',
      'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo',
      'mistralai/Mixtral-8x22B-Instruct-v0.1',
      'mistralai/Mixtral-8x7B-Instruct-v0.1',
      'Qwen/Qwen2.5-72B-Instruct-Turbo',
      'Qwen/Qwen2.5-7B-Instruct-Turbo',
      'deepseek-ai/DeepSeek-R1-Distill-Llama-70B',
      'google/gemma-2-27b-it',
    ],
  };

  private createClient(apiKey: string): OpenAI {
    return new OpenAI({
      apiKey,
      baseURL: 'https://api.together.xyz/v1',
    });
  }

  async *generate(
    request: GenerateRequest,
    apiKey: string,
    signal?: AbortSignal
  ): AsyncGenerator<StreamChunk, GenerateResponse, undefined> {
    const client = this.createClient(apiKey);
    const model = request.model || await modelCacheService.getRandomModel(this.id, apiKey);
    const startTime = Date.now();

    let fullContent = '';
    let promptTokens = 0;
    let completionTokens = 0;
    let finishReason: GenerateResponse['finishReason'] = 'stop';

    console.log(`[Together] Using model: ${model}`);

    try {
      const stream = await client.chat.completions.create(
        {
          model,
          messages: request.messages.map(m => ({
            role: m.role,
            content: m.content,
          })),
          max_tokens: request.maxTokens,
          temperature: request.temperature,
          stop: request.stopSequences,
          stream: true,
        },
        { signal }
      );

      for await (const chunk of stream) {
        if (signal?.aborted) {
          break;
        }

        const choice = chunk.choices[0];
        
        if (choice?.delta?.content) {
          const delta = choice.delta.content;
          fullContent += delta;
          yield { type: 'delta', delta };
        }

        if (choice?.finish_reason) {
          finishReason = this.mapFinishReason(choice.finish_reason);
        }

        if (chunk.usage) {
          promptTokens = chunk.usage.prompt_tokens;
          completionTokens = chunk.usage.completion_tokens;
        }
      }

      const latencyMs = Date.now() - startTime;

      yield {
        type: 'done',
        usage: {
          promptTokens,
          completionTokens,
          totalTokens: promptTokens + completionTokens,
        },
        model,
        finishReason,
      };

      return {
        content: fullContent,
        model,
        usage: {
          promptTokens,
          completionTokens,
          totalTokens: promptTokens + completionTokens,
        },
        finishReason,
        latencyMs,
      };
    } catch (error) {
      const normalized = this.normalizeError(error);
      yield { type: 'error', error: normalized };
      throw error;
    }
  }

  async testConnection(apiKey: string): Promise<ConnectionTestResult> {
    const client = this.createClient(apiKey);
    const startTime = Date.now();

    try {
      await client.models.list();
      
      return {
        success: true,
        latencyMs: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        error: this.normalizeError(error),
        latencyMs: Date.now() - startTime,
      };
    }
  }

  normalizeError(error: unknown, statusCode?: number): NormalizedError {
    if (error instanceof OpenAI.APIError) {
      const status = error.status;

      if (status === 401) {
        return { type: 'auth', message: 'Invalid Together AI API key' };
      }
      if (status === 402) {
        return { type: 'billing', message: 'Together AI billing issue - add credits' };
      }
      if (status === 429) {
        const retryAfter = error.headers?.['retry-after'];
        const retryAfterMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : undefined;
        return { type: 'rate_limit', retryAfterMs, message: error.message };
      }
      if (status && status >= 500) {
        return { type: 'server_error', statusCode: status, message: error.message };
      }

      return { type: 'unknown', message: error.message };
    }

    return super.normalizeError(error, statusCode);
  }

  private mapFinishReason(reason: string): GenerateResponse['finishReason'] {
    switch (reason) {
      case 'stop':
        return 'stop';
      case 'length':
        return 'length';
      case 'content_filter':
        return 'content_filter';
      default:
        return 'stop';
    }
  }
}

// Export singleton instance
export const togetherAdapter = new TogetherAdapter();

