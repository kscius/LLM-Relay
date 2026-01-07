/**
 * Context Window Service
 * 
 * Manages the sliding window of messages sent to LLM providers.
 * This reduces token usage by only sending recent messages,
 * while maintaining conversation coherence.
 */

import { execute, saveDatabase, queryOne } from '../database/sqlite.js';

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

// Default configuration
const DEFAULT_MAX_MESSAGES = 20;  // Last N messages to include

class ContextWindowService {
  /**
   * Get the context window size from settings
   */
  getMaxMessages(): number {
    const row = queryOne<{ value: string }>('SELECT value FROM settings WHERE key = ?', ['contextWindowSize']);
    if (row) {
      const parsed = parseInt(row.value, 10);
      if (!isNaN(parsed) && parsed > 0) {
        return parsed;
      }
    }
    return DEFAULT_MAX_MESSAGES;
  }

  /**
   * Set the context window size
   */
  setMaxMessages(size: number): void {
    if (size > 0 && size <= 100) {
      execute(
        `INSERT INTO settings (key, value, updated_at)
        VALUES (?, ?, datetime('now'))
        ON CONFLICT(key) DO UPDATE SET
          value = excluded.value,
          updated_at = excluded.updated_at`,
        ['contextWindowSize', size.toString()]
      );
      saveDatabase();
    }
  }

  /**
   * Apply sliding window to messages.
   * Keeps system messages + last N user/assistant messages.
   * 
   * @param messages - All messages in the conversation
   * @returns Messages to send to the provider
   */
  applyWindow(messages: ChatMessage[]): ChatMessage[] {
    const maxMessages = this.getMaxMessages();

    // Separate system messages from conversation messages
    const systemMessages = messages.filter(m => m.role === 'system');
    const conversationMessages = messages.filter(m => m.role !== 'system');

    // If we're under the limit, return all messages
    if (conversationMessages.length <= maxMessages) {
      return messages;
    }

    // Take the last N conversation messages
    const windowedConversation = conversationMessages.slice(-maxMessages);

    // Log the windowing action
    const trimmedCount = conversationMessages.length - maxMessages;
    console.log(`[ContextWindow] Trimmed ${trimmedCount} old messages, keeping ${maxMessages}`);

    // Return system messages + windowed conversation
    return [...systemMessages, ...windowedConversation];
  }

  /**
   * Estimate token count for messages (rough approximation)
   * Uses ~4 chars per token as a rough estimate
   */
  estimateTokens(messages: ChatMessage[]): number {
    const totalChars = messages.reduce((sum, m) => sum + m.content.length, 0);
    return Math.ceil(totalChars / 4);
  }

  /**
   * Get context window statistics for a message set
   */
  getStats(allMessages: ChatMessage[], windowedMessages: ChatMessage[]): {
    totalMessages: number;
    windowedMessages: number;
    trimmedMessages: number;
    estimatedTokens: number;
    windowSize: number;
  } {
    return {
      totalMessages: allMessages.length,
      windowedMessages: windowedMessages.length,
      trimmedMessages: allMessages.length - windowedMessages.length,
      estimatedTokens: this.estimateTokens(windowedMessages),
      windowSize: this.getMaxMessages(),
    };
  }
}

export const contextWindowService = new ContextWindowService();

