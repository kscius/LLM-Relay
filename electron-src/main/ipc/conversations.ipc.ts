/**
 * Conversations IPC Handlers
 * 
 * Handles conversation-related IPC messages:
 * - conversation:list - List all conversations
 * - conversation:get - Get a single conversation
 * - conversation:create - Create a new conversation
 * - conversation:update - Update a conversation
 * - conversation:delete - Delete a conversation
 * - conversation:getMessages - Get messages for a conversation
 */

import { IpcMain } from 'electron';
import { conversationRepo, messageRepo } from '../database/repositories/index.js';
import { clearRecentProviders } from '../router/index.js';

interface ConversationCreateRequest {
  title?: string;
}

export function registerConversationHandlers(ipc: IpcMain): void {
  /**
   * List all conversations
   */
  ipc.handle('conversation:list', async () => {
    try {
      const conversations = conversationRepo.list();
      return conversations.map(conv => ({
        id: conv.id,
        title: conv.title,
        createdAt: conv.createdAt,
        updatedAt: conv.updatedAt,
        messageCount: conv.messageCount,
      }));
    } catch (error) {
      console.error('Failed to list conversations:', error);
      return [];
    }
  });

  /**
   * Get a single conversation
   */
  ipc.handle('conversation:get', async (_event, id: string) => {
    try {
      const conversation = conversationRepo.get(id);
      if (!conversation) return null;

      return {
        id: conversation.id,
        title: conversation.title,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
        messageCount: conversation.messageCount,
      };
    } catch (error) {
      console.error('Failed to get conversation:', error);
      return null;
    }
  });

  /**
   * Create a new conversation
   */
  ipc.handle('conversation:create', async (_event, request: ConversationCreateRequest) => {
    try {
      const conversation = conversationRepo.create(request.title);
      return {
        id: conversation.id,
        title: conversation.title,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
        messageCount: 0,
      };
    } catch (error) {
      console.error('Failed to create conversation:', error);
      throw error;
    }
  });

  /**
   * Update a conversation
   */
  ipc.handle('conversation:update', async (_event, id: string, updates: { title?: string; isArchived?: boolean }) => {
    try {
      const conversation = conversationRepo.update(id, updates);
      if (!conversation) return null;

      return {
        id: conversation.id,
        title: conversation.title,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
        messageCount: conversation.messageCount,
      };
    } catch (error) {
      console.error('Failed to update conversation:', error);
      return null;
    }
  });

  /**
   * Delete a conversation
   */
  ipc.handle('conversation:delete', async (_event, id: string) => {
    try {
      // Clear router state for this conversation
      clearRecentProviders(id);
      
      // Delete the conversation (cascade deletes messages)
      return conversationRepo.delete(id);
    } catch (error) {
      console.error('Failed to delete conversation:', error);
      return false;
    }
  });

  /**
   * Get messages for a conversation
   */
  ipc.handle('conversation:getMessages', async (_event, conversationId: string) => {
    try {
      const messages = messageRepo.listByConversation(conversationId);
      return messages.map(msg => ({
        id: msg.id,
        conversationId: msg.conversationId,
        role: msg.role,
        content: msg.content,
        createdAt: msg.createdAt,
        providerId: msg.providerId,
        model: msg.model,
        tokens: msg.tokens,
        latencyMs: msg.latencyMs,
      }));
    } catch (error) {
      console.error('Failed to get messages:', error);
      return [];
    }
  });
}

