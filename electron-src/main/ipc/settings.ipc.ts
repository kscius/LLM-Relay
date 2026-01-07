/**
 * Settings IPC Handlers
 * 
 * Handles settings-related IPC messages:
 * - settings:get - Get all settings
 * - settings:set - Update settings
 * - settings:getContextWindow - Get context window size
 * - settings:setContextWindow - Set context window size
 */

import { IpcMain } from 'electron';
import { settingsRepo, type AppSettings } from '../database/repositories/index.js';
import { contextWindowService } from '../services/context-window.service.js';

export function registerSettingsHandlers(ipc: IpcMain): void {
  /**
   * Get all settings
   */
  ipc.handle('settings:get', async () => {
    try {
      const settings = settingsRepo.getAll();
      return {
        ...settings,
        contextWindowSize: contextWindowService.getMaxMessages(),
      };
    } catch (error) {
      console.error('Failed to get settings:', error);
      return {
        showProviderBadge: true,
        theme: 'dark',
        contextWindowSize: 20,
      };
    }
  });

  /**
   * Update settings
   */
  ipc.handle('settings:set', async (_event, settings: Partial<AppSettings & { contextWindowSize?: number }>) => {
    try {
      // Handle context window size separately
      if (settings.contextWindowSize !== undefined) {
        contextWindowService.setMaxMessages(settings.contextWindowSize);
        delete settings.contextWindowSize;
      }
      return settingsRepo.setAll(settings);
    } catch (error) {
      console.error('Failed to set settings:', error);
      throw error;
    }
  });

  /**
   * Get context window size
   */
  ipc.handle('settings:getContextWindow', async () => {
    return contextWindowService.getMaxMessages();
  });

  /**
   * Set context window size
   */
  ipc.handle('settings:setContextWindow', async (_event, size: number) => {
    contextWindowService.setMaxMessages(size);
    return contextWindowService.getMaxMessages();
  });
}

