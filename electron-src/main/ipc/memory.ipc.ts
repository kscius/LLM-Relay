// Memory IPC - conversation memory ops

import { IpcMain } from 'electron';
import { memoryService } from '../services/memory.service.js';
import { conversationMemoryRepo } from '../database/repositories/index.js';

export function registerMemoryHandlers(ipc: IpcMain): void {
  ipc.handle('memory:get', async (_e, convId: string) => {
    try {
      return memoryService.getMemory(convId) || { summary: null, keyFacts: [] };
    } catch (e) {
      console.error('memory:get failed:', e);
      return { summary: null, keyFacts: [] };
    }
  });

  ipc.handle('memory:summarize', async (_e, convId: string) => {
    try {
      const ok = await memoryService.forceSummarize(convId);
      return ok ? { success: true, memory: memoryService.getMemory(convId) } : { success: false, error: 'Summarization failed' };
    } catch (e) {
      console.error('memory:summarize failed:', e);
      return { success: false, error: e instanceof Error ? e.message : 'Unknown error' };
    }
  });

  ipc.handle('memory:addFact', async (_e, convId: string, fact: string) => {
    try {
      memoryService.addKeyFact(convId, fact);
      return { success: true };
    } catch (e) {
      console.error('memory:addFact failed:', e);
      return { success: false, error: e instanceof Error ? e.message : 'Unknown error' };
    }
  });

  ipc.handle('memory:removeFact', async (_e, convId: string, fact: string) => {
    try {
      memoryService.removeKeyFact(convId, fact);
      return { success: true };
    } catch (e) {
      console.error('memory:removeFact failed:', e);
      return { success: false, error: e instanceof Error ? e.message : 'Unknown error' };
    }
  });

  ipc.handle('memory:setFacts', async (_e, convId: string, facts: string[]) => {
    try {
      conversationMemoryRepo.setKeyFacts(convId, facts);
      return { success: true };
    } catch (e) {
      console.error('memory:setFacts failed:', e);
      return { success: false, error: e instanceof Error ? e.message : 'Unknown error' };
    }
  });

  ipc.handle('memory:clear', async (_e, convId: string) => {
    try {
      memoryService.clearMemory(convId);
      return { success: true };
    } catch (e) {
      console.error('memory:clear failed:', e);
      return { success: false, error: e instanceof Error ? e.message : 'Unknown error' };
    }
  });
}
