// Provider adapter types and base class

export type ProviderId =
  | 'google' | 'mistral' | 'groq' | 'cohere' | 'nvidia' | 'cerebras'
  | 'cloudflare' | 'openrouter'
  | 'openai' | 'anthropic' | 'perplexity' | 'together' | 'deepseek' | 'xai'
  | 'ollama';

export interface ProviderCapabilities {
  supportsStreaming: boolean;
  supportsSystemMessage: boolean;
  supportsFunctionCalling: boolean;
  supportsVision: boolean;
  maxContextTokens: number;
  defaultModel: string;
  availableModels: string[];
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface GenerateRequest {
  messages: ChatMessage[];
  model?: string;
  maxTokens?: number;
  temperature?: number;
  stopSequences?: string[];
}

export interface StreamChunk {
  type: 'delta' | 'error' | 'done';
  delta?: string;
  error?: NormalizedError;
  usage?: UsageStats;
  model?: string;
  finishReason?: 'stop' | 'length' | 'content_filter' | 'error';
}

export interface GenerateResponse {
  content: string;
  model: string;
  usage: UsageStats;
  finishReason: 'stop' | 'length' | 'content_filter' | 'error';
  latencyMs: number;
}

export interface UsageStats {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export type NormalizedError =
  | { type: 'rate_limit'; retryAfterMs?: number; message: string }
  | { type: 'auth'; message: string }
  | { type: 'billing'; message: string }
  | { type: 'context_length'; maxTokens: number; message: string }
  | { type: 'content_filter'; message: string }
  | { type: 'server_error'; statusCode?: number; message: string }
  | { type: 'network'; message: string }
  | { type: 'unknown'; message: string };

export interface ConnectionTestResult {
  success: boolean;
  error?: NormalizedError;
  latencyMs?: number;
}

export interface ProviderAdapter {
  readonly id: ProviderId;
  readonly displayName: string;
  readonly capabilities: ProviderCapabilities;

  generate(
    request: GenerateRequest,
    apiKey: string,
    signal?: AbortSignal
  ): AsyncGenerator<StreamChunk, GenerateResponse, undefined>;

  testConnection(apiKey: string): Promise<ConnectionTestResult>;
  normalizeError(error: unknown, statusCode?: number): NormalizedError;
}

export abstract class BaseProviderAdapter implements ProviderAdapter {
  abstract readonly id: ProviderId;
  abstract readonly displayName: string;
  abstract readonly capabilities: ProviderCapabilities;

  abstract generate(
    request: GenerateRequest,
    apiKey: string,
    signal?: AbortSignal
  ): AsyncGenerator<StreamChunk, GenerateResponse, undefined>;

  abstract testConnection(apiKey: string): Promise<ConnectionTestResult>;

  // Check rate limit BEFORE auth - rate limit msgs often contain "key" which would false-match auth
  normalizeError(error: unknown, statusCode?: number): NormalizedError {
    if (statusCode === 429) {
      return { type: 'rate_limit', message: 'Rate limit exceeded' };
    }
    if (statusCode === 401 || statusCode === 403) {
      return { type: 'auth', message: 'Invalid or expired API key' };
    }
    if (statusCode && statusCode >= 500) {
      return { type: 'server_error', statusCode, message: 'Provider server error' };
    }

    if (error instanceof Error) {
      const msg = error.message.toLowerCase();
      
      if (msg.includes('network') || msg.includes('fetch') || msg.includes('econnrefused')) {
        return { type: 'network', message: error.message };
      }
      
      // rate limit first
      if (msg.includes('429') || msg.includes('rate') || msg.includes('quota') ||
          msg.includes('too many requests') || msg.includes('exceeded your current') ||
          msg.includes('resource_exhausted')) {
        return { type: 'rate_limit', message: error.message };
      }
      
      if ((msg.includes('invalid') && msg.includes('key')) || 
          msg.includes('unauthorized') || msg.includes('authentication failed') ||
          msg.includes('api key not valid')) {
        return { type: 'auth', message: error.message };
      }
      
      if ((msg.includes('context') || msg.includes('token')) && 
          !msg.includes('rate') && !msg.includes('quota')) {
        return { type: 'context_length', maxTokens: 0, message: error.message };
      }
      
      if (msg.includes('content') || msg.includes('filter') || msg.includes('safety')) {
        return { type: 'content_filter', message: error.message };
      }

      return { type: 'unknown', message: error.message };
    }

    return { type: 'unknown', message: String(error) };
  }

  protected createErrorChunk(error: NormalizedError): StreamChunk {
    return { type: 'error', error };
  }

  protected createDoneChunk(usage: UsageStats, model: string, finishReason: StreamChunk['finishReason']): StreamChunk {
    return { type: 'done', usage, model, finishReason };
  }

  selectRandomModel(): string {
    const models = this.capabilities.availableModels;
    return models.length ? models[Math.floor(Math.random() * models.length)] : this.capabilities.defaultModel;
  }
}
