/**
 * Provider Adapter Contract
 * 
 * This file defines the interface that all LLM provider adapters must implement.
 * The contract ensures consistent behavior across different providers.
 */

// Supported provider IDs
export type ProviderId =
  // Free tier providers
  | 'google'
  | 'mistral'
  | 'groq'
  | 'cohere'
  | 'nvidia'
  | 'cerebras'
  | 'cloudflare'
  | 'openrouter'
  // Paid providers
  | 'openai'
  | 'anthropic'
  | 'perplexity'
  | 'together'
  | 'deepseek'
  | 'xai'
  // Local providers
  | 'ollama';

// Provider capabilities for routing decisions
export interface ProviderCapabilities {
  supportsStreaming: boolean;
  supportsSystemMessage: boolean;
  supportsFunctionCalling: boolean;
  supportsVision: boolean;
  maxContextTokens: number;
  defaultModel: string;
  availableModels: string[];
}

// Chat message format for requests
export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

// Request sent to a provider
export interface GenerateRequest {
  messages: ChatMessage[];
  model?: string;
  maxTokens?: number;
  temperature?: number;
  stopSequences?: string[];
}

// Streaming chunk emitted during generation
export interface StreamChunk {
  type: 'delta' | 'error' | 'done';
  delta?: string;
  error?: NormalizedError;
  usage?: UsageStats;
  model?: string;
  finishReason?: 'stop' | 'length' | 'content_filter' | 'error';
}

// Final response after generation completes
export interface GenerateResponse {
  content: string;
  model: string;
  usage: UsageStats;
  finishReason: 'stop' | 'length' | 'content_filter' | 'error';
  latencyMs: number;
}

// Token usage statistics
export interface UsageStats {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

// Normalized error types for consistent handling
export type NormalizedError =
  | { type: 'rate_limit'; retryAfterMs?: number; message: string }
  | { type: 'auth'; message: string }
  | { type: 'billing'; message: string }  // Payment/subscription issues
  | { type: 'context_length'; maxTokens: number; message: string }
  | { type: 'content_filter'; message: string }
  | { type: 'server_error'; statusCode?: number; message: string }
  | { type: 'network'; message: string }
  | { type: 'unknown'; message: string };

// Connection test result
export interface ConnectionTestResult {
  success: boolean;
  error?: NormalizedError;
  latencyMs?: number;
}

/**
 * Provider Adapter Interface
 * 
 * All provider implementations must implement this interface.
 * The adapter handles all provider-specific logic including:
 * - API authentication
 * - Request/response transformation
 * - Streaming normalization
 * - Error mapping
 */
export interface ProviderAdapter {
  /** Unique provider identifier */
  readonly id: ProviderId;
  
  /** Human-readable provider name */
  readonly displayName: string;
  
  /** Provider capabilities for routing decisions */
  readonly capabilities: ProviderCapabilities;

  /**
   * Generate a response from the provider.
   * Returns an AsyncGenerator that yields StreamChunk objects.
   * The final yield contains the complete GenerateResponse.
   * 
   * @param request The generation request
   * @param apiKey The API key for authentication
   * @param signal Optional AbortSignal for cancellation
   */
  generate(
    request: GenerateRequest,
    apiKey: string,
    signal?: AbortSignal
  ): AsyncGenerator<StreamChunk, GenerateResponse, undefined>;

  /**
   * Test the connection and API key validity.
   * Should make a minimal API call to verify the key works.
   * 
   * @param apiKey The API key to test
   */
  testConnection(apiKey: string): Promise<ConnectionTestResult>;

  /**
   * Normalize a provider-specific error into a NormalizedError.
   * Used for consistent error handling across providers.
   * 
   * @param error The raw error from the provider
   * @param statusCode Optional HTTP status code
   */
  normalizeError(error: unknown, statusCode?: number): NormalizedError;
}

/**
 * Base class for provider adapters with common functionality
 */
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

  /**
   * Default error normalization.
   * Subclasses should override for provider-specific error handling.
   * 
   * IMPORTANT: Rate limit errors are checked BEFORE auth errors because
   * rate limit messages may contain words like "key" or "api key" that would
   * incorrectly match auth patterns.
   */
  normalizeError(error: unknown, statusCode?: number): NormalizedError {
    // Handle common HTTP status codes - 429 is rate limit
    if (statusCode === 429) {
      return { type: 'rate_limit', message: 'Rate limit exceeded' };
    }
    if (statusCode === 401 || statusCode === 403) {
      return { type: 'auth', message: 'Invalid or expired API key' };
    }
    if (statusCode && statusCode >= 500) {
      return { type: 'server_error', statusCode, message: 'Provider server error' };
    }

    // Handle error objects
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      
      // Network errors first
      if (message.includes('network') || message.includes('fetch') || message.includes('econnrefused')) {
        return { type: 'network', message: error.message };
      }
      
      // RATE LIMIT CHECK FIRST - before auth check
      // Rate limit errors may contain "key" or similar words that would match auth patterns
      if (message.includes('429') || message.includes('rate') || message.includes('quota') ||
          message.includes('too many requests') || message.includes('exceeded your current') ||
          message.includes('resource_exhausted')) {
        return { type: 'rate_limit', message: error.message };
      }
      
      // Auth errors - but NOT if it's a rate limit error about the key being valid
      if ((message.includes('invalid') && message.includes('key')) || 
          message.includes('unauthorized') || message.includes('authentication failed') ||
          message.includes('api key not valid')) {
        return { type: 'auth', message: error.message };
      }
      
      // Context length errors - but check for rate limit words first
      if ((message.includes('context') || message.includes('token')) && 
          !message.includes('rate') && !message.includes('quota')) {
        return { type: 'context_length', maxTokens: 0, message: error.message };
      }
      
      if (message.includes('content') || message.includes('filter') || message.includes('safety')) {
        return { type: 'content_filter', message: error.message };
      }

      return { type: 'unknown', message: error.message };
    }

    return { type: 'unknown', message: String(error) };
  }

  /**
   * Helper to create a streaming error chunk
   */
  protected createErrorChunk(error: NormalizedError): StreamChunk {
    return { type: 'error', error };
  }

  /**
   * Helper to create a done chunk with usage stats
   */
  protected createDoneChunk(usage: UsageStats, model: string, finishReason: StreamChunk['finishReason']): StreamChunk {
    return { type: 'done', usage, model, finishReason };
  }

  /**
   * Select a random model from available models (static fallback)
   */
  selectRandomModel(): string {
    const models = this.capabilities.availableModels;
    if (models.length === 0) {
      return this.capabilities.defaultModel;
    }
    return models[Math.floor(Math.random() * models.length)];
  }
}

