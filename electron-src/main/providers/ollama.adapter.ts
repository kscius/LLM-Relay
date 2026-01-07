/**
 * Ollama Adapter
 * 
 * Connects to locally running Ollama instance.
 * Uses OpenAI-compatible API at /v1/chat/completions
 * No API key required for local models.
 */

import {
  BaseProviderAdapter,
  type ProviderId,
  type ProviderCapabilities,
  type GenerateRequest,
  type GenerateResponse,
  type StreamChunk,
  type ConnectionTestResult,
  type NormalizedError,
} from './base.js';

// Default Ollama URL
const DEFAULT_OLLAMA_URL = 'http://localhost:11434';

// Popular Ollama models
const OLLAMA_MODELS = [
  'llama3.2:latest',
  'llama3.1:latest',
  'llama3:latest',
  'mistral:latest',
  'mixtral:latest',
  'codellama:latest',
  'phi3:latest',
  'gemma2:latest',
  'qwen2.5:latest',
];

export class OllamaAdapter extends BaseProviderAdapter {
  readonly id: ProviderId = 'ollama' as ProviderId;
  readonly displayName = 'Ollama (Local)';
  readonly capabilities: ProviderCapabilities = {
    supportsStreaming: true,
    supportsSystemMessage: true,
    supportsFunctionCalling: false,
    supportsVision: false,
    maxContextTokens: 128000,
    defaultModel: 'llama3.2:latest',
    availableModels: OLLAMA_MODELS,
  };

  private getBaseUrl(apiKey: string): string {
    // apiKey can be used to store custom URL (e.g., "http://192.168.1.100:11434")
    if (apiKey && apiKey.startsWith('http')) {
      return apiKey.replace(/\/$/, '');
    }
    return DEFAULT_OLLAMA_URL;
  }

  async testConnection(apiKey: string): Promise<ConnectionTestResult> {
    const baseUrl = this.getBaseUrl(apiKey);
    const startTime = Date.now();

    try {
      // Test with a simple API call
      const response = await fetch(`${baseUrl}/api/tags`, {
        method: 'GET',
      });

      if (!response.ok) {
        throw new Error(`Ollama returned ${response.status}`);
      }

      const data = await response.json() as { models?: Array<{ name: string }> };
      
      if (!data.models) {
        return {
          success: false,
          error: {
            type: 'server_error',
            message: 'No models found in Ollama. Pull a model first with: ollama pull llama3.2',
          },
          latencyMs: Date.now() - startTime,
        };
      }

      // Update available models from Ollama
      if (data.models.length > 0) {
        this.capabilities.availableModels = data.models.map(m => m.name);
        this.capabilities.defaultModel = data.models[0].name;
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

  async *generate(
    request: GenerateRequest,
    apiKey: string,
    signal?: AbortSignal
  ): AsyncGenerator<StreamChunk, GenerateResponse, undefined> {
    const baseUrl = this.getBaseUrl(apiKey);
    const model = request.model || this.capabilities.defaultModel;
    const startTime = Date.now();

    let fullContent = '';
    let promptTokens = 0;
    let completionTokens = 0;

    try {
      const response = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: request.messages,
          stream: true,
          max_tokens: request.maxTokens,
          temperature: request.temperature,
        }),
        signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Ollama error: ${response.status} ${errorText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body');
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;

          const data = trimmed.slice(6);
          if (data === '[DONE]') continue;

          try {
            const parsed = JSON.parse(data) as {
              choices?: Array<{
                delta?: { content?: string };
                finish_reason?: string;
              }>;
              usage?: {
                prompt_tokens?: number;
                completion_tokens?: number;
              };
            };

            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) {
              fullContent += delta;
              yield { type: 'delta', delta };
            }

            if (parsed.usage) {
              promptTokens = parsed.usage.prompt_tokens || 0;
              completionTokens = parsed.usage.completion_tokens || 0;
            }

            if (parsed.choices?.[0]?.finish_reason) {
              break;
            }
          } catch {
            // Ignore parse errors for malformed chunks
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
        finishReason: 'stop',
      };

      return {
        content: fullContent,
        model,
        usage: {
          promptTokens,
          completionTokens,
          totalTokens: promptTokens + completionTokens,
        },
        finishReason: 'stop',
        latencyMs,
      };
    } catch (error) {
      const normalizedError = this.normalizeError(error);
      yield { type: 'error', error: normalizedError };

      return {
        content: fullContent,
        model,
        usage: {
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
        },
        finishReason: 'error',
        latencyMs: Date.now() - startTime,
      };
    }
  }

  normalizeError(error: unknown, statusCode?: number): NormalizedError {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();

      // Connection errors (Ollama not running)
      if (
        message.includes('econnrefused') ||
        message.includes('network') ||
        message.includes('fetch')
      ) {
        return {
          type: 'network',
          message: 'Cannot connect to Ollama. Make sure Ollama is running locally.',
        };
      }

      // Model not found
      if (message.includes('model') && message.includes('not found')) {
        return {
          type: 'unknown',
          message: `Model not found. Pull it first with: ollama pull ${this.capabilities.defaultModel}`,
        };
      }
    }

    return super.normalizeError(error, statusCode);
  }
}

export const ollamaAdapter = new OllamaAdapter();

