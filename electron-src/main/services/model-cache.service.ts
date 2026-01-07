// Model discovery with caching - dynamic fetch + static fallback

import { modelsCacheRepo } from '../database/repositories/index.js';
import { providerRegistry, type ProviderId } from '../providers/index.js';

export interface ModelInfo {
  id: string;
  name?: string;
  contextLength?: number;
}

class ModelCacheService {
  private refreshPromises: Map<ProviderId, Promise<string[]>> = new Map();

  async getModels(providerId: ProviderId, apiKey?: string): Promise<string[]> {
    if (modelsCacheRepo.isCacheValid(providerId)) {
      const cached = modelsCacheRepo.getModelIds(providerId);
      if (cached.length > 0) {
        console.log(`models: using cache for ${providerId} (${cached.length})`);
        return cached;
      }
    }

    if (apiKey) {
      try {
        return await this.refreshModels(providerId, apiKey);
      } catch (e) {
        console.warn(`models: fetch failed for ${providerId}, using static:`, e);
      }
    }

    return this.getStaticModels(providerId);
  }

  async getRandomModel(providerId: ProviderId, apiKey?: string): Promise<string> {
    const models = await this.getModels(providerId, apiKey);
    if (!models.length) {
      const adapter = providerRegistry.get(providerId);
      return adapter?.capabilities.defaultModel || 'unknown';
    }
    return models[Math.floor(Math.random() * models.length)];
  }

  async refreshModels(providerId: ProviderId, apiKey: string): Promise<string[]> {
    const existing = this.refreshPromises.get(providerId);
    if (existing) return existing;

    const promise = this.doRefresh(providerId, apiKey);
    this.refreshPromises.set(providerId, promise);

    try {
      return await promise;
    } finally {
      this.refreshPromises.delete(providerId);
    }
  }

  private async doRefresh(providerId: ProviderId, apiKey: string): Promise<string[]> {
    const adapter = providerRegistry.get(providerId);
    if (!adapter) throw new Error(`Unknown provider: ${providerId}`);

    console.log(`models: fetching for ${providerId}...`);
    const models = await this.fetchFromProvider(providerId, apiKey);

    if (models.length) {
      modelsCacheRepo.updateCache(providerId, models);
      return models.map(m => m.id);
    }

    return this.getStaticModels(providerId);
  }

  private async fetchFromProvider(providerId: ProviderId, apiKey: string): Promise<ModelInfo[]> {
    const adapter = providerRegistry.get(providerId);
    if (!adapter) return [];

    const openaiLike = ['mistral', 'groq', 'nvidia', 'cerebras', 'openai', 'together', 'deepseek', 'xai', 'perplexity'];
    
    if (openaiLike.includes(providerId)) {
      return this.fetchOpenAILike(providerId, apiKey);
    }

    if (providerId === 'cohere') return this.fetchCohere(apiKey);

    // google, anthropic don't have simple model list endpoints
    return [];
  }

  private async fetchOpenAILike(providerId: ProviderId, apiKey: string): Promise<ModelInfo[]> {
    const urls: Record<string, string> = {
      mistral: 'https://api.mistral.ai/v1',
      groq: 'https://api.groq.com/openai/v1',
      nvidia: 'https://integrate.api.nvidia.com/v1',
      cerebras: 'https://api.cerebras.ai/v1',
      openai: 'https://api.openai.com/v1',
      together: 'https://api.together.xyz/v1',
      deepseek: 'https://api.deepseek.com',
      xai: 'https://api.x.ai/v1',
      perplexity: 'https://api.perplexity.ai',
    };

    const baseUrl = urls[providerId];
    if (!baseUrl) return [];

    try {
      const res = await fetch(`${baseUrl}/models`, {
        headers: { 'Authorization': `Bearer ${apiKey}` },
      });

      if (!res.ok) {
        console.warn(`models: ${providerId} returned ${res.status}`);
        return [];
      }

      const data = await res.json();
      const models = data.data || data.models || [];

      return models
        .filter((m: { id: string }) => this.isChatModel(providerId, m.id))
        .map((m: { id: string; name?: string; context_length?: number; context_window?: number }) => ({
          id: m.id,
          name: m.name || m.id,
          contextLength: m.context_length || m.context_window,
        }));
    } catch (e) {
      console.warn(`models: fetch ${providerId} failed:`, e);
      return [];
    }
  }

  private async fetchCohere(apiKey: string): Promise<ModelInfo[]> {
    try {
      const res = await fetch('https://api.cohere.com/v1/models', {
        headers: { 'Authorization': `Bearer ${apiKey}` },
      });
      if (!res.ok) return [];

      const data = await res.json();
      return (data.models || [])
        .filter((m: { endpoints?: string[] }) => m.endpoints?.includes('chat'))
        .map((m: { name: string; context_length?: number }) => ({
          id: m.name,
          name: m.name,
          contextLength: m.context_length,
        }));
    } catch {
      return [];
    }
  }

  private isChatModel(providerId: string, modelId: string): boolean {
    const id = modelId.toLowerCase();

    // Skip non-chat models
    const skip = ['embed', 'whisper', 'dall-e', 'tts', 'moderation', 'realtime', 'guard',
                  'vision', 'ocr', 'transcription', 'classification', 'rerank', 'detector'];
    if (skip.some(p => id.includes(p))) return false;

    // Provider specific
    if (providerId === 'mistral') {
      return (id.includes('mistral') || id.includes('mixtral') || id.includes('codestral')) && !id.includes('embed');
    }
    if (providerId === 'groq') {
      const validFamily = id.includes('llama') || id.includes('mixtral') || id.includes('gemma');
      const nonChat = id.includes('guard') || id.includes('vision') || id.includes('scout') ||
                      (id.includes('maverick') && id.includes('128e'));
      return validFamily && !nonChat;
    }
    if (providerId === 'openai') return id.includes('gpt') || id.startsWith('o1') || id.startsWith('o3');
    if (providerId === 'together') return id.includes('instruct') || id.includes('chat') || id.includes('turbo');
    if (providerId === 'xai') return id.includes('grok');
    if (providerId === 'perplexity') return id.includes('sonar');
    if (providerId === 'deepseek') {
      return id.includes('deepseek') && (id.includes('chat') || id.includes('coder') || id.includes('reasoner') || !id.includes('-'));
    }

    return true;
  }

  getStaticModels(providerId: ProviderId): string[] {
    return providerRegistry.get(providerId)?.capabilities.availableModels || [];
  }

  clearCache(providerId: ProviderId): void {
    modelsCacheRepo.clearCache(providerId);
  }

  clearAllCache(): void {
    modelsCacheRepo.clearAll();
  }

  getCacheStats(): { providerId: string; modelCount: number; expiresAt: string }[] {
    return modelsCacheRepo.getStats();
  }

  async refreshAllProviders(getApiKey: (providerId: ProviderId) => string | null): Promise<void> {
    const providers = providerRegistry.listIds();
    
    await Promise.allSettled(providers.map(async (pid) => {
      const key = getApiKey(pid);
      if (key) {
        try {
          await this.refreshModels(pid, key);
        } catch (e) {
          console.warn(`models: refresh ${pid} failed:`, e);
        }
      }
    }));
  }
}

export const modelCacheService = new ModelCacheService();
