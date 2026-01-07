/**
 * Usage IPC Handlers
 * 
 * Handles provider usage tracking and limits:
 * - usage:getStatus - Get usage status for a provider
 * - usage:getAllStatus - Get usage status for all providers with limits
 * - usage:setLimits - Set limits for a provider
 * - usage:reset - Reset usage for a provider
 */

import { IpcMain } from 'electron';
import { providerUsageRepo, type ProviderLimits } from '../database/repositories/index.js';
import type { ProviderId } from '../providers/base.js';

export function registerUsageHandlers(ipc: IpcMain): void {
  /**
   * Get usage status for a specific provider
   */
  ipc.handle('usage:getStatus', async (_event, providerId: ProviderId) => {
    try {
      return providerUsageRepo.getUsageStatus(providerId);
    } catch (error) {
      console.error('Failed to get usage status:', error);
      return null;
    }
  });

  /**
   * Get usage status for all providers with limits
   */
  ipc.handle('usage:getAllStatus', async () => {
    try {
      return providerUsageRepo.getAllUsageStatus();
    } catch (error) {
      console.error('Failed to get all usage status:', error);
      return [];
    }
  });

  /**
   * Set limits for a provider
   */
  ipc.handle('usage:setLimits', async (_event, providerId: ProviderId, limits: Partial<Omit<ProviderLimits, 'providerId'>>) => {
    try {
      providerUsageRepo.setLimits(providerId, limits);
      return { success: true };
    } catch (error) {
      console.error('Failed to set limits:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  /**
   * Reset usage for a provider (for testing/debugging)
   */
  ipc.handle('usage:reset', async (_event, providerId: ProviderId) => {
    try {
      providerUsageRepo.resetUsage(providerId);
      return { success: true };
    } catch (error) {
      console.error('Failed to reset usage:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  /**
   * Check if a provider is locked
   */
  ipc.handle('usage:isLocked', async (_event, providerId: ProviderId) => {
    try {
      return providerUsageRepo.isLocked(providerId);
    } catch (error) {
      console.error('Failed to check lock status:', error);
      return false;
    }
  });
}

