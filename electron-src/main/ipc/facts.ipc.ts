// Facts IPC - global facts operations

import { IpcMain } from 'electron';
import { factsService } from '../services/facts.service.js';
import { globalFactsRepo, type FactCategory, type CreateFactInput } from '../database/repositories/index.js';

export function registerFactsHandlers(ipc: IpcMain): void {
  ipc.handle('facts:list', async () => {
    try {
      return factsService.listGlobalFacts();
    } catch (e) {
      console.error('facts:list failed:', e);
      return [];
    }
  });

  ipc.handle('facts:listByCategory', async (_e, category: FactCategory) => {
    try {
      return factsService.listByCategory(category);
    } catch (e) {
      console.error('facts:listByCategory failed:', e);
      return [];
    }
  });

  ipc.handle('facts:listForConversation', async (_e, convId: string) => {
    try {
      return globalFactsRepo.listForConversation(convId);
    } catch (e) {
      console.error('facts:listForConversation failed:', e);
      return [];
    }
  });

  ipc.handle('facts:add', async (_e, input: CreateFactInput) => {
    try {
      return { success: true, fact: factsService.addFact(input) };
    } catch (e) {
      console.error('facts:add failed:', e);
      return { success: false, error: e instanceof Error ? e.message : 'Unknown error' };
    }
  });

  ipc.handle('facts:update', async (_e, id: string, updates: { fact?: string; category?: FactCategory; confidence?: number }) => {
    try {
      return { success: factsService.updateFact(id, updates) };
    } catch (e) {
      console.error('facts:update failed:', e);
      return { success: false, error: e instanceof Error ? e.message : 'Unknown error' };
    }
  });

  ipc.handle('facts:remove', async (_e, id: string) => {
    try {
      return { success: factsService.removeFact(id) };
    } catch (e) {
      console.error('facts:remove failed:', e);
      return { success: false, error: e instanceof Error ? e.message : 'Unknown error' };
    }
  });

  ipc.handle('facts:delete', async (_e, id: string) => {
    try {
      return { success: factsService.deleteFact(id) };
    } catch (e) {
      console.error('facts:delete failed:', e);
      return { success: false, error: e instanceof Error ? e.message : 'Unknown error' };
    }
  });

  ipc.handle('facts:stats', async () => {
    try {
      return factsService.getStats();
    } catch (e) {
      console.error('facts:stats failed:', e);
      return { total: 0, byCategory: {}, global: 0, conversation: 0 };
    }
  });

  ipc.handle('facts:extract', async (_e, text: string, convId?: string) => {
    try {
      const facts = await factsService.extractFactsFromMessage(text, convId || 'manual');
      return { success: true, facts };
    } catch (e) {
      console.error('facts:extract failed:', e);
      return { success: false, error: e instanceof Error ? e.message : 'Unknown error' };
    }
  });
}
