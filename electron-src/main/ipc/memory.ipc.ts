/**
 * Memory IPC Handlers
 * 
 * Handles conversation memory operations:
 * - memory:get - Get memory for a conversation
 * - memory:summarize - Force summarization
 * - memory:addFact - Add a key fact
 * - memory:removeFact - Remove a key fact
 * - memory:clear - Clear memory for a conversation
 */

import { IpcMain } from 'electron';
import { memoryService } from '../services/memory.service.js';
import { conversationMemoryRepo } from '../database/repositories/index.js';

export function registerMemoryHandlers(ipc: IpcMain): void {
  /**
   * Get memory for a conversation
   */
  ipc.handle('memory:get', async (_event, conversationId: string) => {
    try {
      const memory = memoryService.getMemory(conversationId);
      return memory || { summary: null, keyFacts: [] };
    } catch (error) {
      console.error('Failed to get memory:', error);
      return { summary: null, keyFacts: [] };
    }
  });

  /**
   * Force summarization of a conversation
   */
  ipc.handle('memory:summarize', async (_event, conversationId: string) => {
    try {
      const success = await memoryService.forceSummarize(conversationId);
      if (success) {
        return { success: true, memory: memoryService.getMemory(conversationId) };
      }
      return { success: false, error: 'Summarization failed' };
    } catch (error) {
      console.error('Failed to summarize:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  /**
   * Add a key fact to a conversation
   */
  ipc.handle('memory:addFact', async (_event, conversationId: string, fact: string) => {
    try {
      memoryService.addKeyFact(conversationId, fact);
      return { success: true };
    } catch (error) {
      console.error('Failed to add fact:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  /**
   * Remove a key fact from a conversation
   */
  ipc.handle('memory:removeFact', async (_event, conversationId: string, fact: string) => {
    try {
      memoryService.removeKeyFact(conversationId, fact);
      return { success: true };
    } catch (error) {
      console.error('Failed to remove fact:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  /**
   * Update key facts for a conversation
   */
  ipc.handle('memory:setFacts', async (_event, conversationId: string, facts: string[]) => {
    try {
      conversationMemoryRepo.setKeyFacts(conversationId, facts);
      return { success: true };
    } catch (error) {
      console.error('Failed to set facts:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  /**
   * Clear memory for a conversation
   */
  ipc.handle('memory:clear', async (_event, conversationId: string) => {
    try {
      memoryService.clearMemory(conversationId);
      return { success: true };
    } catch (error) {
      console.error('Failed to clear memory:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });
}

