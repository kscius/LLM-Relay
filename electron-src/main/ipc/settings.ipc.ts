// Settings IPC - app settings & context window

import { IpcMain } from 'electron';
import { settingsRepo, type AppSettings } from '../database/repositories/index.js';
import { contextWindowService } from '../services/context-window.service.js';

export function registerSettingsHandlers(ipc: IpcMain): void {
  ipc.handle('settings:get', async () => {
    try {
      const s = settingsRepo.getAll();
      return { ...s, contextWindowSize: contextWindowService.getMaxMessages() };
    } catch (e) {
      console.error('settings:get failed:', e);
      return { showProviderBadge: true, theme: 'dark', contextWindowSize: 20 };
    }
  });

  ipc.handle('settings:set', async (_e, settings: Partial<AppSettings & { contextWindowSize?: number }>) => {
    try {
      if (settings.contextWindowSize !== undefined) {
        contextWindowService.setMaxMessages(settings.contextWindowSize);
        delete settings.contextWindowSize;
      }
      return settingsRepo.setAll(settings);
    } catch (e) {
      console.error('settings:set failed:', e);
      throw e;
    }
  });

  ipc.handle('settings:getContextWindow', async () => contextWindowService.getMaxMessages());

  ipc.handle('settings:setContextWindow', async (_e, size: number) => {
    contextWindowService.setMaxMessages(size);
    return contextWindowService.getMaxMessages();
  });
}
