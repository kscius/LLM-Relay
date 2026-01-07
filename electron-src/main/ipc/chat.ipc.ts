/**
 * Chat IPC Handlers
 * 
 * Handles chat-related IPC messages:
 * - chat:send - Send a message and get streaming response
 * - chat:regenerate - Regenerate the last assistant message
 * - chat:cancel - Cancel an in-progress request
 */

import { IpcMain, BrowserWindow, ipcMain } from 'electron';
import { routeAndSaveMessage } from '../router/index.js';
import { messageRepo, conversationRepo } from '../database/repositories/index.js';
import { factsService } from '../services/facts.service.js';

// Track active requests for cancellation
const activeRequests = new Map<string, AbortController>();

interface SendRequest {
  conversationId: string;
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
}

export function registerChatHandlers(ipc: IpcMain): void {
  /**
   * Send a message and stream the response
   */
  ipc.handle('chat:send', async (event, request: SendRequest) => {
    const { conversationId, messages } = request;
    console.log('[chat:send] Request received:', { conversationId, messageCount: messages?.length });

    // Get the window for streaming
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) {
      console.error('[chat:send] Window not found');
      return { success: false, error: 'Window not found' };
    }

    // Create abort controller for cancellation
    const abortController = new AbortController();
    activeRequests.set(conversationId, abortController);

    try {
      // Create user message if it's new
      const lastUserMessage = messages[messages.length - 1];
      if (lastUserMessage?.role === 'user') {
        messageRepo.create({
          conversationId,
          role: 'user',
          content: lastUserMessage.content,
        });

        // Update conversation title from first message
        const conversation = conversationRepo.get(conversationId);
        if (conversation && conversation.messageCount <= 1) {
          const title = conversationRepo.generateTitle(lastUserMessage.content);
          conversationRepo.update(conversationId, { title });
        }
      }

      // Route the message
      const result = await routeAndSaveMessage({
        conversationId,
        messages,
        window,
        signal: abortController.signal,
      });

      if (result.success) {
        console.log('[chat:send] Success:', { messageId: result.messageId, providerId: result.providerId });
        
        // Extract facts from user message in background (don't block response)
        if (lastUserMessage?.content) {
          factsService.extractFactsFromMessage(
            lastUserMessage.content,
            conversationId,
            result.messageId
          ).catch(err => console.error('[chat:send] Fact extraction failed:', err));
        }
        
        return {
          success: true,
          messageId: result.messageId,
        };
      } else {
        const errorMsg = result.error?.message || (typeof result.error === 'string' ? result.error : JSON.stringify(result.error) || 'Unknown error');
        console.error('[chat:send] Failed:', errorMsg);
        return {
          success: false,
          error: errorMsg,
        };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : (typeof error === 'string' ? error : JSON.stringify(error) || 'Unknown error');
      console.error('[chat:send] Exception:', message, error);
      return { success: false, error: message };
    } finally {
      activeRequests.delete(conversationId);
    }
  });

  /**
   * Regenerate the last assistant message
   */
  ipc.handle('chat:regenerate', async (event, conversationId: string, messageId: string) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) {
      return { success: false, error: 'Window not found' };
    }

    try {
      // Get the message to regenerate
      const message = messageRepo.get(messageId);
      if (!message || message.role !== 'assistant') {
        return { success: false, error: 'Message not found or not an assistant message' };
      }

      // Mark the old message as regenerated
      messageRepo.markRegenerated(messageId);

      // Get all messages up to (but not including) this one
      const allMessages = messageRepo.listByConversation(conversationId);
      const messageIndex = allMessages.findIndex(m => m.id === messageId);
      const contextMessages = allMessages.slice(0, messageIndex).map(m => ({
        role: m.role,
        content: m.content,
      }));

      // Create abort controller
      const abortController = new AbortController();
      activeRequests.set(conversationId, abortController);

      // Route the message
      const result = await routeAndSaveMessage({
        conversationId,
        messages: contextMessages,
        window,
        signal: abortController.signal,
      });

      activeRequests.delete(conversationId);

      if (result.success) {
        return { success: true, messageId: result.messageId };
      } else {
        return { success: false, error: result.error?.message || 'Unknown error' };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: message };
    }
  });

  /**
   * Cancel an in-progress request
   */
  ipcMain.on('chat:cancel', (_event, conversationId: string) => {
    const controller = activeRequests.get(conversationId);
    if (controller) {
      controller.abort();
      activeRequests.delete(conversationId);
    }
  });
}

