import {
  BaseProviderAdapter,
  GenerateRequest,
  GenerateResponse,
  StreamChunk,
  ConnectionTestResult,
  NormalizedError,
  ProviderCapabilities,
  ChatMessage,
} from './base.js';
import { modelCacheService } from '../services/model-cache.service.js';

/**
 * Cohere Provider Adapter
 * 
 * Native Cohere API implementation. Supports Command R+, Command R.
 */
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
    availableModels: [
      'command-r-plus',
      'command-r',
      'command',
      'command-light',
    ],
  };

  private readonly baseUrl = 'https://api.cohere.com/v2';

  async *generate(
    request: GenerateRequest,
    apiKey: string,
    signal?: AbortSignal
  ): AsyncGenerator<StreamChunk, GenerateResponse, undefined> {
    // Use cache-aware random model selection if no specific model requested
    const model = request.model || await modelCacheService.getRandomModel(this.id, apiKey);
    const startTime = Date.now();

    let fullContent = '';
    let promptTokens = 0;
    let completionTokens = 0;
    let finishReason: GenerateResponse['finishReason'] = 'stop';

    console.log(`[Cohere] Using model: ${model}`);

    try {
      const response = await fetch(`${this.baseUrl}/chat`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream',
        },
        body: JSON.stringify({
          model,
          messages: this.convertMessages(request.messages),
          max_tokens: request.maxTokens,
          temperature: request.temperature,
          stop_sequences: request.stopSequences,
          stream: true,
        }),
        signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new CohereAPIError(response.status, errorText);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body');
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        if (signal?.aborted) {
          reader.cancel();
          break;
        }

        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim() || !line.startsWith('data: ')) continue;

          const jsonStr = line.slice(6);
          if (jsonStr === '[DONE]') continue;

          try {
            const data = JSON.parse(jsonStr);

            if (data.type === 'content-delta' && data.delta?.message?.content?.text) {
              const delta = data.delta.message.content.text;
              fullContent += delta;
              yield { type: 'delta', delta };
            }

            if (data.type === 'message-end') {
              if (data.delta?.finish_reason) {
                finishReason = this.mapFinishReason(data.delta.finish_reason);
              }
              if (data.delta?.usage) {
                promptTokens = data.delta.usage.billed_units?.input_tokens || 0;
                completionTokens = data.delta.usage.billed_units?.output_tokens || 0;
              }
            }
          } catch {
            // Skip invalid JSON lines
          }
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
    const startTime = Date.now();

    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new CohereAPIError(response.status, errorText);
      }

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
    if (error instanceof CohereAPIError) {
      if (error.status === 401) {
        return { type: 'auth', message: 'Invalid Cohere API key' };
      }
      if (error.status === 429) {
        return { type: 'rate_limit', message: error.message };
      }
      if (error.status >= 500) {
        return { type: 'server_error', statusCode: error.status, message: error.message };
      }

      return { type: 'unknown', message: error.message };
    }

    return super.normalizeError(error, statusCode);
  }

  private convertMessages(messages: ChatMessage[]): Array<{ role: string; content: string }> {
    return messages.map(m => ({
      role: m.role === 'assistant' ? 'assistant' : m.role === 'system' ? 'system' : 'user',
      content: m.content,
    }));
  }

  private mapFinishReason(reason: string): GenerateResponse['finishReason'] {
    switch (reason) {
      case 'COMPLETE':
        return 'stop';
      case 'MAX_TOKENS':
        return 'length';
      case 'STOP_SEQUENCE':
        return 'stop';
      default:
        return 'stop';
    }
  }
}

class CohereAPIError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'CohereAPIError';
  }
}

// Export singleton instance
export const cohereAdapter = new CohereAdapter();

