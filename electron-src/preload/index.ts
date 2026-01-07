import { contextBridge, ipcRenderer } from 'electron';

// Type definitions matching src/lib/api.ts
interface GenerateRequest {
  conversationId: string;
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
}

interface ConversationCreateRequest {
  title?: string;
}

interface ProviderKeyRequest {
  providerId: string;
  apiKey: string;
}

interface StreamChunk {
  type: 'delta' | 'error' | 'done';
  delta?: string;
  error?: { type: string; message: string };
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
}

// Expose API to renderer
contextBridge.exposeInMainWorld('api', {
  // Chat operations
  chat: {
    send: (request: GenerateRequest) =>
      ipcRenderer.invoke('chat:send', request),
    
    regenerate: (conversationId: string, messageId: string) =>
      ipcRenderer.invoke('chat:regenerate', conversationId, messageId),
    
    cancel: (conversationId: string) =>
      ipcRenderer.send('chat:cancel', conversationId),
    
    onStream: (conversationId: string, callback: (chunk: StreamChunk) => void) => {
      const channel = `chat:stream:${conversationId}`;
      const handler = (_event: Electron.IpcRendererEvent, chunk: StreamChunk) => {
        callback(chunk);
      };
      ipcRenderer.on(channel, handler);
      return () => {
        ipcRenderer.removeListener(channel, handler);
      };
    },
  },

  // Conversation operations
  conversations: {
    list: () => ipcRenderer.invoke('conversation:list'),
    get: (id: string) => ipcRenderer.invoke('conversation:get', id),
    create: (request: ConversationCreateRequest) =>
      ipcRenderer.invoke('conversation:create', request),
    update: (id: string, updates: object) =>
      ipcRenderer.invoke('conversation:update', id, updates),
    delete: (id: string) => ipcRenderer.invoke('conversation:delete', id),
    getMessages: (id: string) =>
      ipcRenderer.invoke('conversation:getMessages', id),
  },

  // Provider operations
  providers: {
    list: () => ipcRenderer.invoke('provider:list'),
    addKey: (request: ProviderKeyRequest) =>
      ipcRenderer.invoke('provider:add', request),
    removeKey: (providerId: string) =>
      ipcRenderer.invoke('provider:remove', providerId),
    testKey: (request: ProviderKeyRequest) =>
      ipcRenderer.invoke('provider:test', request),
    getHealth: () => ipcRenderer.invoke('provider:health'),
  },

  // Settings operations
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (settings: object) => ipcRenderer.invoke('settings:set', settings),
  },

  // App info
  app: {
    version: () => '0.1.0',
    platform: () => process.platform,
  },
});

