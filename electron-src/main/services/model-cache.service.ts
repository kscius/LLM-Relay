/**
 * Model Cache Service
 * 
 * Manages dynamic model discovery with caching.
 * Provides hybrid approach: dynamic fetch + static fallback + cache.
 */

import { modelsCacheRepo } from '../database/repositories/index.js';
import { providerRegistry, type ProviderId } from '../providers/index.js';

export interface ModelInfo {
  id: string;
  name?: string;
  contextLength?: number;
}

class ModelCacheService {
  private refreshPromises: Map<ProviderId, Promise<string[]>> = new Map();

  /**
   * Get available models for a provider.
   * Uses cache if valid, otherwise fetches from API.
   * Falls back to static list if fetch fails.
   */
  async getModels(providerId: ProviderId, apiKey?: string): Promise<string[]> {
    // Check cache first
    if (modelsCacheRepo.isCacheValid(providerId)) {
      const cached = modelsCacheRepo.getModelIds(providerId);
      if (cached.length > 0) {
        console.log(`[ModelCache] Using cached models for ${providerId}: ${cached.length} models`);
        return cached;
      }
    }

    // If we have an API key, try to fetch
    if (apiKey) {
      try {
        return await this.refreshModels(providerId, apiKey);
      } catch (error) {
        console.warn(`[ModelCache] Failed to fetch models for ${providerId}, using static list:`, error);
      }
    }

    // Fallback to static list
    return this.getStaticModels(providerId);
  }

  /**
   * Get a random model for a provider
   */
  async getRandomModel(providerId: ProviderId, apiKey?: string): Promise<string> {
    const models = await this.getModels(providerId, apiKey);
    if (models.length === 0) {
      // Ultimate fallback
      const adapter = providerRegistry.get(providerId);
      return adapter?.capabilities.defaultModel || 'unknown';
    }
    return models[Math.floor(Math.random() * models.length)];
  }

  /**
   * Refresh models from API and update cache
   */
  async refreshModels(providerId: ProviderId, apiKey: string): Promise<string[]> {
    // Avoid duplicate requests
    const existing = this.refreshPromises.get(providerId);
    if (existing) {
      return existing;
    }

    const promise = this.doRefreshModels(providerId, apiKey);
    this.refreshPromises.set(providerId, promise);

    try {
      return await promise;
    } finally {
      this.refreshPromises.delete(providerId);
    }
  }

  private async doRefreshModels(providerId: ProviderId, apiKey: string): Promise<string[]> {
    const adapter = providerRegistry.get(providerId);
    if (!adapter) {
      throw new Error(`Unknown provider: ${providerId}`);
    }

    console.log(`[ModelCache] Fetching models for ${providerId}...`);

    // Try to fetch models from provider
    const models = await this.fetchModelsFromProvider(providerId, apiKey);

    if (models.length > 0) {
      // Update cache
      modelsCacheRepo.updateCache(providerId, models);
      return models.map(m => m.id);
    }

    // Fallback to static
    return this.getStaticModels(providerId);
  }

  /**
   * Fetch models from provider API
   */
  private async fetchModelsFromProvider(providerId: ProviderId, apiKey: string): Promise<ModelInfo[]> {
    const adapter = providerRegistry.get(providerId);
    if (!adapter) return [];

    // OpenAI-compatible providers (including paid ones)
    const openaiCompatibleProviders = [
      'mistral', 'groq', 'nvidia', 'cerebras',
      'openai', 'together', 'deepseek', 'xai', 'perplexity'
    ];
    
    if (openaiCompatibleProviders.includes(providerId)) {
      return this.fetchOpenAICompatibleModels(providerId, apiKey);
    }

    // Provider-specific implementations
    if (providerId === 'google') {
      // Google doesn't have a simple models list endpoint
      return [];
    }

    if (providerId === 'anthropic') {
      // Anthropic doesn't have a public models list endpoint
      return [];
    }

    if (providerId === 'cohere') {
      return this.fetchCohereModels(apiKey);
    }

    return [];
  }

  /**
   * Fetch models from OpenAI-compatible API
   */
  private async fetchOpenAICompatibleModels(providerId: ProviderId, apiKey: string): Promise<ModelInfo[]> {
    const baseUrls: Record<string, string> = {
      // Free tier providers
      mistral: 'https://api.mistral.ai/v1',
      groq: 'https://api.groq.com/openai/v1',
      nvidia: 'https://integrate.api.nvidia.com/v1',
      cerebras: 'https://api.cerebras.ai/v1',
      // Paid providers
      openai: 'https://api.openai.com/v1',
      together: 'https://api.together.xyz/v1',
      deepseek: 'https://api.deepseek.com',
      xai: 'https://api.x.ai/v1',
      perplexity: 'https://api.perplexity.ai',
    };

    const baseUrl = baseUrls[providerId];
    if (!baseUrl) return [];

    try {
      const response = await fetch(`${baseUrl}/models`, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
        },
      });

      if (!response.ok) {
        console.warn(`[ModelCache] ${providerId} models API returned ${response.status}`);
        return [];
      }

      const data = await response.json();
      const models = data.data || data.models || [];

      // Filter to chat-capable models
      return models
        .filter((m: { id: string }) => this.isChatModel(providerId, m.id))
        .map((m: { id: string; name?: string; context_length?: number; context_window?: number }) => ({
          id: m.id,
          name: m.name || m.id,
          contextLength: m.context_length || m.context_window,
        }));
    } catch (error) {
      console.warn(`[ModelCache] Failed to fetch ${providerId} models:`, error);
      return [];
    }
  }

  /**
   * Fetch models from Cohere API
   */
  private async fetchCohereModels(apiKey: string): Promise<ModelInfo[]> {
    try {
      const response = await fetch('https://api.cohere.com/v1/models', {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
        },
      });

      if (!response.ok) return [];

      const data = await response.json();
      const models = data.models || [];

      return models
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

  /**
   * Check if a model is suitable for chat
   */
  private isChatModel(providerId: string, modelId: string): boolean {
    const id = modelId.toLowerCase();

    // Global exclusions - models that are NOT for chat/completion
    const excludePatterns = [
      'embed',           // Embedding models
      'whisper',         // Speech-to-text
      'dall-e',          // Image generation
      'tts',             // Text-to-speech
      'moderation',      // Content moderation
      'realtime',        // Realtime API
      'guard',           // Safety/guard models (e.g., llama-prompt-guard)
      'vision',          // Vision-only models (unless also chat)
      'ocr',             // OCR models
      'transcription',   // Audio transcription
      'classification',  // Classification models
      'rerank',          // Reranking models
      'detector',        // Detection models
    ];

    for (const pattern of excludePatterns) {
      if (id.includes(pattern)) {
        return false;
      }
    }

    // Provider-specific filters
    if (providerId === 'mistral') {
      // Only include known chat/instruction models
      return (id.includes('mistral') || id.includes('mixtral') || id.includes('codestral')) &&
             !id.includes('embed');
    }

    if (providerId === 'groq') {
      // Include Llama, Mixtral, Gemma - but exclude non-chat variants
      const isValidFamily = id.includes('llama') || id.includes('mixtral') || id.includes('gemma');
      // Exclude specialized models that aren't for chat
      const isNonChat = id.includes('guard') || id.includes('vision') || id.includes('scout') ||
                        id.includes('maverick') && id.includes('128e'); // 128e = experimental
      return isValidFamily && !isNonChat;
    }

    if (providerId === 'openai') {
      // Only include GPT and o1/o3 models
      return id.includes('gpt') || id.startsWith('o1') || id.startsWith('o3');
    }

    if (providerId === 'together') {
      // Include instruct and chat models
      return id.includes('instruct') || id.includes('chat') || id.includes('turbo');
    }

    if (providerId === 'xai') {
      return id.includes('grok');
    }

    if (providerId === 'perplexity') {
      return id.includes('sonar');
    }

    if (providerId === 'deepseek') {
      return id.includes('deepseek') && (id.includes('chat') || id.includes('coder') || 
             id.includes('reasoner') || !id.includes('-'));
    }

    // For most providers, accept all non-excluded models
    return true;
  }

  /**
   * Get static fallback models for a provider
   */
  getStaticModels(providerId: ProviderId): string[] {
    const adapter = providerRegistry.get(providerId);
    return adapter?.capabilities.availableModels || [];
  }

  /**
   * Clear cache for a provider
   */
  clearCache(providerId: ProviderId): void {
    modelsCacheRepo.clearCache(providerId);
  }

  /**
   * Clear all cache
   */
  clearAllCache(): void {
    modelsCacheRepo.clearAll();
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { providerId: string; modelCount: number; expiresAt: string }[] {
    return modelsCacheRepo.getStats();
  }

  /**
   * Refresh all providers that have API keys
   */
  async refreshAllProviders(getApiKey: (providerId: ProviderId) => string | null): Promise<void> {
    const providers = providerRegistry.listIds();
    
    const refreshPromises = providers.map(async (providerId) => {
      const apiKey = getApiKey(providerId);
      if (apiKey) {
        try {
          await this.refreshModels(providerId, apiKey);
        } catch (error) {
          console.warn(`[ModelCache] Failed to refresh ${providerId}:`, error);
        }
      }
    });

    await Promise.allSettled(refreshPromises);
  }
}

export const modelCacheService = new ModelCacheService();

