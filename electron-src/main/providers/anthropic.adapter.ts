import Anthropic from '@anthropic-ai/sdk';
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
 * Anthropic Provider Adapter
 * 
 * Creator of Claude models. Known for safety and coding capabilities.
 * Uses the official Anthropic API with x-api-key authentication.
 */
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
      'claude-sonnet-4-20250514',
      'claude-3-5-sonnet-20241022',
      'claude-3-5-haiku-20241022',
      'claude-3-opus-20240229',
      'claude-3-haiku-20240307',
    ],
  };

  private createClient(apiKey: string): Anthropic {
    return new Anthropic({
      apiKey,
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

    console.log(`[Anthropic] Using model: ${model}`);

    // Extract system message if present
    const systemMessage = request.messages.find(m => m.role === 'system');
    const nonSystemMessages = request.messages.filter(m => m.role !== 'system');

    try {
      const stream = client.messages.stream(
        {
          model,
          system: systemMessage?.content,
          messages: nonSystemMessages.map(m => ({
            role: m.role as 'user' | 'assistant',
            content: m.content,
          })),
          max_tokens: request.maxTokens || 4096,
          temperature: request.temperature,
          stop_sequences: request.stopSequences,
        },
        { signal }
      );

      for await (const event of stream) {
        if (signal?.aborted) {
          break;
        }

        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          const delta = event.delta.text;
          fullContent += delta;
          yield { type: 'delta', delta };
        }

        if (event.type === 'message_delta' && event.usage) {
          completionTokens = event.usage.output_tokens;
        }

        if (event.type === 'message_stop') {
          // Message completed
        }
      }

      // Get final message for usage info
      const finalMessage = await stream.finalMessage();
      promptTokens = finalMessage.usage.input_tokens;
      completionTokens = finalMessage.usage.output_tokens;
      finishReason = this.mapStopReason(finalMessage.stop_reason);

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
      // Anthropic doesn't have a models.list endpoint, so we make a minimal API call
      await client.messages.create({
        model: 'claude-3-haiku-20240307',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'Hi' }],
      });
      
      return {
        success: true,
        latencyMs: Date.now() - startTime,
      };
    } catch (error) {
      // Check if it's just a rate limit or billing error (key is valid)
      if (error instanceof Anthropic.APIError) {
        if (error.status === 529) {
          // Overloaded but key is valid
          return {
            success: true,
            latencyMs: Date.now() - startTime,
          };
        }
      }
      
      return {
        success: false,
        error: this.normalizeError(error),
        latencyMs: Date.now() - startTime,
      };
    }
  }

  normalizeError(error: unknown, statusCode?: number): NormalizedError {
    if (error instanceof Anthropic.APIError) {
      const status = error.status;

      if (status === 401) {
        return { type: 'auth', message: 'Invalid Anthropic API key' };
      }
      if (status === 402 || status === 403) {
        return { type: 'billing', message: 'Anthropic billing issue - check your subscription' };
      }
      if (status === 429) {
        return { type: 'rate_limit', message: error.message };
      }
      if (status === 529) {
        return { type: 'server_error', statusCode: status, message: 'Anthropic API is overloaded' };
      }
      if (status && status >= 500) {
        return { type: 'server_error', statusCode: status, message: error.message };
      }

      return { type: 'unknown', message: error.message };
    }

    return super.normalizeError(error, statusCode);
  }

  private mapStopReason(reason: string | null): GenerateResponse['finishReason'] {
    switch (reason) {
      case 'end_turn':
      case 'stop_sequence':
        return 'stop';
      case 'max_tokens':
        return 'length';
      default:
        return 'stop';
    }
  }
}

// Export singleton instance
export const anthropicAdapter = new AnthropicAdapter();

