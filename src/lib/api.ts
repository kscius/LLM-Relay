/**
 * Type definitions for the preload bridge API
 * This file defines the shape of window.api exposed by preload script
 */

import type { Message, Conversation, Provider, AppSettings, StreamChunk } from '../types';

export interface GenerateRequest {
  conversationId: string;
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
}

export interface ConversationCreateRequest {
  title?: string;
}

export interface ProviderKeyRequest {
  providerId: string;
  apiKey: string;
}

export interface ConversationMemory {
  conversationId: string;
  summary: string | null;
  keyFacts: string[];
  lastSummarizedAt: string | null;
  messageCountAtSummary: number | null;
}

export interface GlobalFact {
  id: string;
  fact: string;
  category: 'personal' | 'preference' | 'project' | 'technical' | 'temporary';
  scope: 'global' | 'conversation';
  confidence: number;
  source: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  expiresAt: string | null;
}

export interface ElectronAPI {
  // Chat operations
  chat: {
    send: (request: GenerateRequest) => Promise<{ success: boolean; messageId?: string; error?: string }>;
    regenerate: (conversationId: string, messageId: string) => Promise<{ success: boolean; error?: string }>;
    cancel: (conversationId: string) => void;
    onStream: (conversationId: string, callback: (chunk: StreamChunk) => void) => () => void;
  };

  // Conversation operations
  conversations: {
    list: () => Promise<Conversation[]>;
    get: (id: string) => Promise<Conversation | null>;
    create: (request: ConversationCreateRequest) => Promise<Conversation>;
    update: (id: string, updates: Partial<Conversation>) => Promise<Conversation | null>;
    delete: (id: string) => Promise<boolean>;
    getMessages: (id: string) => Promise<Message[]>;
  };

  // Provider operations
  providers: {
    list: () => Promise<Provider[]>;
    addKey: (request: ProviderKeyRequest) => Promise<{ success: boolean; error?: string }>;
    removeKey: (providerId: string) => Promise<boolean>;
    testKey: (request: ProviderKeyRequest) => Promise<{ success: boolean; error?: string; latencyMs?: number }>;
    testExistingKey: (providerId: string) => Promise<{ success: boolean; error?: string; latencyMs?: number }>;
    getHealth: () => Promise<Record<string, { score: number; status: string }>>;
  };

  // Memory operations
  memory: {
    get: (conversationId: string) => Promise<ConversationMemory | null>;
    summarize: (conversationId: string) => Promise<{ success: boolean }>;
    addFact: (conversationId: string, fact: string) => Promise<{ success: boolean }>;
    removeFact: (conversationId: string, fact: string) => Promise<{ success: boolean }>;
    setFacts: (conversationId: string, facts: string[]) => Promise<{ success: boolean }>;
    clearMemory: (conversationId: string) => Promise<{ success: boolean }>;
  };

  // Global facts operations
  facts: {
    list: () => Promise<GlobalFact[]>;
    add: (fact: string, category?: string) => Promise<{ success: boolean; id?: string }>;
    update: (id: string, updates: Partial<GlobalFact>) => Promise<{ success: boolean }>;
    remove: (id: string) => Promise<{ success: boolean }>;
    delete: (id: string) => Promise<{ success: boolean }>;
  };

  // Settings operations
  settings: {
    get: () => Promise<AppSettings>;
    set: (settings: Partial<AppSettings>) => Promise<AppSettings>;
  };

  // App info
  app: {
    version: () => string;
    platform: () => string;
  };
}

declare global {
  interface Window {
    api: ElectronAPI;
  }
}

