/**
 * Providers IPC Handlers
 * 
 * Handles provider-related IPC messages:
 * - provider:list - List all providers with status
 * - provider:add - Add/update an API key
 * - provider:remove - Remove an API key
 * - provider:test - Test an API key
 * - provider:health - Get health status for all providers
 */

import { IpcMain } from 'electron';
import { providerRepo } from '../database/repositories/index.js';
import { providerRegistry, type ProviderId } from '../providers/index.js';
import { getAllProviderHealth } from '../router/health.js';
import { getAllCircuitStates } from '../router/circuit-breaker.js';

interface ProviderKeyRequest {
  providerId: string;
  apiKey: string;
}

export function registerProviderHandlers(ipc: IpcMain): void {
  /**
   * List all providers with their status
   */
  ipc.handle('provider:list', async () => {
    try {
      console.log('[provider:list] Fetching providers...');
      const providers = providerRepo.list();
      console.log('[provider:list] Got providers:', providers.length);
      const healthInfo = getAllProviderHealth();
      console.log('[provider:list] Got health info:', healthInfo.length);
      const circuitStates = getAllCircuitStates();

      return providers.map(provider => {
        const health = healthInfo.find(h => h.providerId === provider.id);
        const circuit = circuitStates.find(c => c.providerId === provider.id);
        const adapter = providerRegistry.get(provider.id as ProviderId);

        return {
          id: provider.id,
          displayName: provider.displayName,
          description: provider.description,
          enabled: provider.isEnabled,
          hasKey: provider.hasKey,
          keyHint: provider.keyHint,
          isHealthy: health?.isAvailable ?? false,
          healthScore: health?.score ?? 0,
          healthStatus: health?.status ?? 'unavailable',
          circuitState: circuit?.state ?? 'closed',
          supportsStreaming: adapter?.capabilities.supportsStreaming ?? false,
          defaultModel: adapter?.capabilities.defaultModel,
        };
      });
    } catch (error) {
      console.error('Failed to list providers:', error);
      return [];
    }
  });

  /**
   * Add or update an API key for a provider
   * Now validates the connection before saving
   */
  ipc.handle('provider:add', async (_event, request: ProviderKeyRequest & { skipValidation?: boolean }) => {
    try {
      const { providerId, apiKey, skipValidation } = request;

      // Validate the key format (basic check)
      if (!apiKey || apiKey.trim().length < 10) {
        return { success: false, error: 'Invalid API key format', validated: false };
      }

      const trimmedKey = apiKey.trim();

      // Test connection before saving (unless skipped)
      if (!skipValidation) {
        const adapter = providerRegistry.get(providerId as ProviderId);
        if (adapter) {
          console.log(`[provider:add] Testing connection for ${providerId}...`);
          const testResult = await adapter.testConnection(trimmedKey);
          
          if (!testResult.success) {
            console.log(`[provider:add] Connection test failed for ${providerId}:`, testResult.error?.message);
            return { 
              success: false, 
              error: testResult.error?.message || 'Connection test failed',
              validated: true,
              latencyMs: testResult.latencyMs,
            };
          }
          
          console.log(`[provider:add] Connection test passed for ${providerId} (${testResult.latencyMs}ms)`);
        }
      }

      // Save the key
      providerRepo.saveKey(providerId, trimmedKey);

      return { success: true, validated: !skipValidation };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('Failed to add provider key:', error);
      return { success: false, error: message, validated: false };
    }
  });

  /**
   * Remove an API key
   */
  ipc.handle('provider:remove', async (_event, providerId: string) => {
    try {
      return providerRepo.removeKey(providerId);
    } catch (error) {
      console.error('Failed to remove provider key:', error);
      return false;
    }
  });

  /**
   * Test an API key (new key being entered)
   */
  ipc.handle('provider:test', async (_event, request: ProviderKeyRequest) => {
    try {
      const { providerId, apiKey } = request;

      // Get the adapter
      const adapter = providerRegistry.get(providerId as ProviderId);
      if (!adapter) {
        return { success: false, error: 'Provider not found' };
      }

      // Test the connection
      const result = await adapter.testConnection(apiKey.trim());

      if (result.success) {
        return { success: true, latencyMs: result.latencyMs };
      } else {
        return {
          success: false,
          error: result.error?.message || 'Connection test failed',
        };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('Failed to test provider:', error);
      return { success: false, error: message };
    }
  });

  /**
   * Test an existing (saved) API key
   */
  ipc.handle('provider:testExisting', async (_event, providerId: string) => {
    try {
      // Get the saved key
      const apiKey = providerRepo.getKey(providerId);
      if (!apiKey) {
        return { success: false, error: 'No API key saved for this provider' };
      }

      // Get the adapter
      const adapter = providerRegistry.get(providerId as ProviderId);
      if (!adapter) {
        return { success: false, error: 'Provider not found' };
      }

      console.log(`[provider:testExisting] Testing saved key for ${providerId}...`);
      
      // Test the connection
      const result = await adapter.testConnection(apiKey);

      if (result.success) {
        console.log(`[provider:testExisting] ${providerId} connection OK (${result.latencyMs}ms)`);
        return { success: true, latencyMs: result.latencyMs };
      } else {
        console.log(`[provider:testExisting] ${providerId} connection FAILED:`, result.error?.message);
        return {
          success: false,
          error: result.error?.message || 'Connection test failed',
        };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('Failed to test existing provider key:', error);
      return { success: false, error: message };
    }
  });

  /**
   * Get health status for all providers
   */
  ipc.handle('provider:health', async () => {
    try {
      const healthInfo = getAllProviderHealth();
      const circuitStates = getAllCircuitStates();

      const result: Record<string, { score: number; status: string; circuitState: string }> = {};

      for (const health of healthInfo) {
        const circuit = circuitStates.find(c => c.providerId === health.providerId);
        result[health.providerId] = {
          score: health.score,
          status: health.status,
          circuitState: circuit?.state ?? 'closed',
        };
      }

      return result;
    } catch (error) {
      console.error('Failed to get provider health:', error);
      return {};
    }
  });

  /**
   * Update provider settings (enable/disable, priority)
   */
  ipc.handle('provider:update', async (_event, providerId: string, updates: { isEnabled?: boolean; priority?: number }) => {
    try {
      return providerRepo.update(providerId, updates);
    } catch (error) {
      console.error('Failed to update provider:', error);
      return false;
    }
  });
}

