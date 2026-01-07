/**
 * Facts IPC Handlers
 * 
 * Handles global facts operations:
 * - facts:list - List all global facts
 * - facts:listByCategory - List facts by category
 * - facts:add - Add a new fact
 * - facts:update - Update a fact
 * - facts:remove - Remove (deactivate) a fact
 * - facts:delete - Permanently delete a fact
 * - facts:stats - Get fact statistics
 */

import { IpcMain } from 'electron';
import { factsService } from '../services/facts.service.js';
import { globalFactsRepo, type FactCategory, type CreateFactInput } from '../database/repositories/index.js';

export function registerFactsHandlers(ipc: IpcMain): void {
  /**
   * List all active global facts
   */
  ipc.handle('facts:list', async () => {
    try {
      return factsService.listGlobalFacts();
    } catch (error) {
      console.error('Failed to list facts:', error);
      return [];
    }
  });

  /**
   * List facts by category
   */
  ipc.handle('facts:listByCategory', async (_event, category: FactCategory) => {
    try {
      return factsService.listByCategory(category);
    } catch (error) {
      console.error('Failed to list facts by category:', error);
      return [];
    }
  });

  /**
   * List facts for a conversation (includes global)
   */
  ipc.handle('facts:listForConversation', async (_event, conversationId: string) => {
    try {
      return globalFactsRepo.listForConversation(conversationId);
    } catch (error) {
      console.error('Failed to list facts for conversation:', error);
      return [];
    }
  });

  /**
   * Add a new fact
   */
  ipc.handle('facts:add', async (_event, input: CreateFactInput) => {
    try {
      const fact = factsService.addFact(input);
      return { success: true, fact };
    } catch (error) {
      console.error('Failed to add fact:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  /**
   * Update a fact
   */
  ipc.handle('facts:update', async (_event, id: string, updates: { fact?: string; category?: FactCategory; confidence?: number }) => {
    try {
      const success = factsService.updateFact(id, updates);
      return { success };
    } catch (error) {
      console.error('Failed to update fact:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  /**
   * Remove (deactivate) a fact
   */
  ipc.handle('facts:remove', async (_event, id: string) => {
    try {
      const success = factsService.removeFact(id);
      return { success };
    } catch (error) {
      console.error('Failed to remove fact:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  /**
   * Permanently delete a fact
   */
  ipc.handle('facts:delete', async (_event, id: string) => {
    try {
      const success = factsService.deleteFact(id);
      return { success };
    } catch (error) {
      console.error('Failed to delete fact:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  /**
   * Get fact statistics
   */
  ipc.handle('facts:stats', async () => {
    try {
      return factsService.getStats();
    } catch (error) {
      console.error('Failed to get fact stats:', error);
      return { total: 0, byCategory: {}, global: 0, conversation: 0 };
    }
  });

  /**
   * Extract facts from text (manual trigger)
   */
  ipc.handle('facts:extract', async (_event, text: string, conversationId?: string) => {
    try {
      const facts = await factsService.extractFactsFromMessage(text, conversationId || 'manual');
      return { success: true, facts };
    } catch (error) {
      console.error('Failed to extract facts:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });
}

