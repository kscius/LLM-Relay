// Core message types
export interface Message {
  id: string;
  conversationId?: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: number;
  providerId?: string;
  model?: string;
  tokens?: number;
  latencyMs?: number;
}

// Conversation types
export interface Conversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount?: number;
}

// Provider types
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

export interface Provider {
  id: ProviderId;
  displayName: string;
  description: string;
  enabled: boolean;
  hasKey: boolean;
  isHealthy: boolean;
  healthScore?: number;
}

// Settings types
export interface AppSettings {
  showProviderBadge: boolean;
  theme: 'dark' | 'light' | 'system';
  contextWindowSize: number;  // Number of recent messages to send to providers
  systemPrompt: string;  // Custom system prompt prepended to all conversations
}

// Streaming types
export interface StreamChunk {
  type: 'delta' | 'error' | 'done';
  delta?: string;
  error?: NormalizedError;
  usage?: UsageStats;
}

export interface UsageStats {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

// Error types
export type NormalizedError =
  | { type: 'rate_limit'; retryAfterMs?: number; message: string }
  | { type: 'auth'; message: string }
  | { type: 'billing'; message: string }  // Payment/subscription issues
  | { type: 'context_length'; maxTokens: number; message: string }
  | { type: 'content_filter'; message: string }
  | { type: 'server_error'; statusCode?: number; message: string }
  | { type: 'network'; message: string }
  | { type: 'unknown'; message: string };

