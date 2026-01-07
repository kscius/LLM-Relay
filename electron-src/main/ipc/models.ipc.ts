/**
 * Models IPC Handlers
 * 
 * Handles model cache related IPC messages:
 * - models:list - Get available models for a provider
 * - models:refresh - Force refresh models from API
 * - models:refresh-all - Refresh all providers
 * - models:cache-stats - Get cache statistics
 * - models:clear-cache - Clear cache for a provider
 */

import { IpcMain } from 'electron';
import { modelCacheService } from '../services/model-cache.service.js';
import { providerRepo } from '../database/repositories/index.js';
import type { ProviderId } from '../providers/index.js';

export function registerModelsHandlers(ipc: IpcMain): void {
  /**
   * Get available models for a provider (uses cache)
   */
  ipc.handle('models:list', async (_event, providerId: ProviderId) => {
    try {
      const apiKey = providerRepo.getKey(providerId);
      const models = await modelCacheService.getModels(providerId, apiKey || undefined);
      return { success: true, models };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: message, models: [] };
    }
  });

  /**
   * Force refresh models from API
   */
  ipc.handle('models:refresh', async (_event, providerId: ProviderId) => {
    try {
      const apiKey = providerRepo.getKey(providerId);
      if (!apiKey) {
        return { success: false, error: 'No API key configured', models: [] };
      }

      const models = await modelCacheService.refreshModels(providerId, apiKey);
      console.log(`[models:refresh] Refreshed ${models.length} models for ${providerId}`);
      return { success: true, models };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[models:refresh] Failed for ${providerId}:`, message);
      return { success: false, error: message, models: [] };
    }
  });

  /**
   * Refresh all providers with API keys
   */
  ipc.handle('models:refresh-all', async () => {
    try {
      await modelCacheService.refreshAllProviders((providerId) => providerRepo.getKey(providerId));
      const stats = modelCacheService.getCacheStats();
      console.log('[models:refresh-all] Completed:', stats);
      return { success: true, stats };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: message };
    }
  });

  /**
   * Get cache statistics
   */
  ipc.handle('models:cache-stats', async () => {
    try {
      const stats = modelCacheService.getCacheStats();
      return { success: true, stats };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: message, stats: [] };
    }
  });

  /**
   * Clear cache for a provider
   */
  ipc.handle('models:clear-cache', async (_event, providerId?: ProviderId) => {
    try {
      if (providerId) {
        modelCacheService.clearCache(providerId);
      } else {
        modelCacheService.clearAllCache();
      }
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: message };
    }
  });
}

