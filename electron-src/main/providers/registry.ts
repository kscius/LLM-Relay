import type { ProviderAdapter, ProviderId } from './base.js';
// Free tier providers
import { googleAdapter } from './google.adapter.js';
import { mistralAdapter } from './mistral.adapter.js';
import { groqAdapter } from './groq.adapter.js';
import { cohereAdapter } from './cohere.adapter.js';
import { nvidiaAdapter } from './nvidia.adapter.js';
import { cerebrasAdapter } from './cerebras.adapter.js';
import { cloudflareAdapter } from './cloudflare.adapter.js';
import { openrouterAdapter } from './openrouter.adapter.js';
// Paid providers
import { openaiAdapter } from './openai.adapter.js';
import { anthropicAdapter } from './anthropic.adapter.js';
import { perplexityAdapter } from './perplexity.adapter.js';
import { togetherAdapter } from './together.adapter.js';
import { deepseekAdapter } from './deepseek.adapter.js';
import { xaiAdapter } from './xai.adapter.js';
// Local providers
import { ollamaAdapter } from './ollama.adapter.js';

/**
 * Provider Registry
 * 
 * Singleton registry of all available provider adapters.
 * Provides methods to get, list, and check provider availability.
 */
class ProviderRegistry {
  private adapters: Map<ProviderId, ProviderAdapter>;

  constructor() {
    this.adapters = new Map();
    
    // Register free tier providers
    this.register(googleAdapter);
    this.register(mistralAdapter);
    this.register(groqAdapter);
    this.register(cohereAdapter);
    this.register(nvidiaAdapter);
    this.register(cerebrasAdapter);
    this.register(cloudflareAdapter);
    this.register(openrouterAdapter);
    
    // Register paid providers
    this.register(openaiAdapter);
    this.register(anthropicAdapter);
    this.register(perplexityAdapter);
    this.register(togetherAdapter);
    this.register(deepseekAdapter);
    this.register(xaiAdapter);
    
    // Register local providers
    this.register(ollamaAdapter);
  }

  /**
   * Register a provider adapter
   */
  register(adapter: ProviderAdapter): void {
    this.adapters.set(adapter.id, adapter);
  }

  /**
   * Get a provider adapter by ID
   */
  get(id: ProviderId): ProviderAdapter | undefined {
    return this.adapters.get(id);
  }

  /**
   * Check if a provider exists
   */
  has(id: ProviderId): boolean {
    return this.adapters.has(id);
  }

  /**
   * List all registered provider adapters
   */
  list(): ProviderAdapter[] {
    return Array.from(this.adapters.values());
  }

  /**
   * List all registered provider IDs
   */
  listIds(): ProviderId[] {
    return Array.from(this.adapters.keys());
  }

  /**
   * Get the count of registered providers
   */
  get size(): number {
    return this.adapters.size;
  }
}

// Export singleton instance
export const providerRegistry = new ProviderRegistry();

// Re-export types and adapters for convenience
export type { ProviderAdapter, ProviderId } from './base.js';
// Free tier adapters
export { googleAdapter } from './google.adapter.js';
export { mistralAdapter } from './mistral.adapter.js';
export { groqAdapter } from './groq.adapter.js';
export { cohereAdapter } from './cohere.adapter.js';
export { nvidiaAdapter } from './nvidia.adapter.js';
export { cerebrasAdapter } from './cerebras.adapter.js';
export { cloudflareAdapter } from './cloudflare.adapter.js';
export { openrouterAdapter } from './openrouter.adapter.js';
// Paid adapters
export { openaiAdapter } from './openai.adapter.js';
export { anthropicAdapter } from './anthropic.adapter.js';
export { perplexityAdapter } from './perplexity.adapter.js';
export { togetherAdapter } from './together.adapter.js';
export { deepseekAdapter } from './deepseek.adapter.js';
export { xaiAdapter } from './xai.adapter.js';
// Local adapters
export { ollamaAdapter } from './ollama.adapter.js';

