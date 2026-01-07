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
 * Groq Provider Adapter
 * 
 * Uses OpenAI-compatible API. Known for ultra-fast inference.
 * Supports Llama 3, Mixtral, and other open-source models.
 */
export class GroqAdapter extends BaseProviderAdapter {
  readonly id = 'groq' as const;
  readonly displayName = 'Groq';

  readonly capabilities: ProviderCapabilities = {
    supportsStreaming: true,
    supportsSystemMessage: true,
    supportsFunctionCalling: true,
    supportsVision: false,
    maxContextTokens: 131072,
    defaultModel: 'llama-3.3-70b-versatile',
    availableModels: [
      'llama-3.3-70b-versatile',
      'llama-3.1-8b-instant',
      'llama-3.2-3b-preview',
      'mixtral-8x7b-32768',
      'gemma2-9b-it',
    ],
  };

  private createClient(apiKey: string): OpenAI {
    return new OpenAI({
      apiKey,
      baseURL: 'https://api.groq.com/openai/v1',
    });
  }

  async *generate(
    request: GenerateRequest,
    apiKey: string,
    signal?: AbortSignal
  ): AsyncGenerator<StreamChunk, GenerateResponse, undefined> {
    const client = this.createClient(apiKey);
    // Use cache-aware random model selection if no specific model requested
    const model = request.model || await modelCacheService.getRandomModel(this.id, apiKey);
    const startTime = Date.now();

    let fullContent = '';
    let promptTokens = 0;
    let completionTokens = 0;
    let finishReason: GenerateResponse['finishReason'] = 'stop';

    console.log(`[Groq] Using model: ${model}`);

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
        return { type: 'auth', message: 'Invalid Groq API key' };
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
export const groqAdapter = new GroqAdapter();

