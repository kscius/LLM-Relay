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
 * xAI Provider Adapter
 * 
 * Elon Musk's AI company, creator of Grok models.
 * Uses OpenAI-compatible API. Known for Grok-2 and Grok-3.
 */
export class XAIAdapter extends BaseProviderAdapter {
  readonly id = 'xai' as const;
  readonly displayName = 'xAI';

  readonly capabilities: ProviderCapabilities = {
    supportsStreaming: true,
    supportsSystemMessage: true,
    supportsFunctionCalling: true,
    supportsVision: true,
    maxContextTokens: 131072,
    defaultModel: 'grok-3-mini-beta',
    availableModels: [
      'grok-3-beta',
      'grok-3-fast-beta',
      'grok-3-mini-beta',
      'grok-3-mini-fast-beta',
      'grok-2-latest',
      'grok-2-vision-latest',
    ],
  };

  private createClient(apiKey: string): OpenAI {
    return new OpenAI({
      apiKey,
      baseURL: 'https://api.x.ai/v1',
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

    console.log(`[xAI] Using model: ${model}`);

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
      // xAI has a models endpoint
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
        return { type: 'auth', message: 'Invalid xAI API key' };
      }
      if (status === 402) {
        return { type: 'billing', message: 'xAI billing issue - add credits' };
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
export const xaiAdapter = new XAIAdapter();

