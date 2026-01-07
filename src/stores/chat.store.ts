import { create } from 'zustand';
import type { Message, StreamChunk } from '../types';

interface ChatState {
  currentConversationId: string | null;
  messages: Message[];
  isLoading: boolean;
  isStreaming: boolean;
  streamingContent: string;
  error: string | null;

  // Actions
  setCurrentConversation: (id: string | null) => void;
  setMessages: (messages: Message[]) => void;
  addMessage: (message: Message) => void;
  updateMessage: (id: string, updates: Partial<Message>) => void;
  setLoading: (loading: boolean) => void;
  setStreaming: (streaming: boolean) => void;
  appendStreamContent: (content: string) => void;
  clearStreamContent: () => void;
  setError: (error: string | null) => void;
  reset: () => void;
}

const initialState = {
  currentConversationId: null,
  messages: [],
  isLoading: false,
  isStreaming: false,
  streamingContent: '',
  error: null,
};

export const useChatStore = create<ChatState>((set) => ({
  ...initialState,

  setCurrentConversation: (id) => set({ currentConversationId: id }),

  setMessages: (messages) => set({ messages }),

  addMessage: (message) =>
    set((state) => ({ messages: [...state.messages, message] })),

  updateMessage: (id, updates) =>
    set((state) => ({
      messages: state.messages.map((m) =>
        m.id === id ? { ...m, ...updates } : m
      ),
    })),

  setLoading: (isLoading) => set({ isLoading }),

  setStreaming: (isStreaming) => set({ isStreaming }),

  appendStreamContent: (content) =>
    set((state) => ({ streamingContent: state.streamingContent + content })),

  clearStreamContent: () => set({ streamingContent: '' }),

  setError: (error) => set({ error }),

  reset: () => set(initialState),
}));

// Helper hook for handling stream chunks
export function handleStreamChunk(chunk: StreamChunk, store: ChatState) {
  switch (chunk.type) {
    case 'delta':
      if (chunk.delta) {
        store.appendStreamContent(chunk.delta);
      }
      break;
    case 'error':
      store.setError(chunk.error?.message || 'Unknown error');
      store.setStreaming(false);
      break;
    case 'done':
      store.setStreaming(false);
      break;
  }
}

