import { describe, it, expect } from 'vitest';

/**
 * Tests for context window service - sliding window message truncation
 */
describe('Context Window Service', () => {
  interface ChatMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
  }

  describe('sliding window', () => {
    const applyWindow = (
      messages: ChatMessage[],
      maxMessages: number
    ): ChatMessage[] => {
      // Separate system messages from conversation messages
      const systemMessages = messages.filter(m => m.role === 'system');
      const conversationMessages = messages.filter(m => m.role !== 'system');

      // If we're under the limit, return all messages
      if (conversationMessages.length <= maxMessages) {
        return messages;
      }

      // Take the last N conversation messages
      const windowedConversation = conversationMessages.slice(-maxMessages);

      // Return system messages + windowed conversation
      return [...systemMessages, ...windowedConversation];
    };

    it('should return all messages when under limit', () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
        { role: 'user', content: 'How are you?' },
      ];

      const result = applyWindow(messages, 10);
      expect(result).toHaveLength(3);
      expect(result).toEqual(messages);
    });

    it('should trim old messages when over limit', () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'Message 1' },
        { role: 'assistant', content: 'Reply 1' },
        { role: 'user', content: 'Message 2' },
        { role: 'assistant', content: 'Reply 2' },
        { role: 'user', content: 'Message 3' },
        { role: 'assistant', content: 'Reply 3' },
      ];

      const result = applyWindow(messages, 4);
      expect(result).toHaveLength(4);
      expect(result[0].content).toBe('Message 2');
      expect(result[3].content).toBe('Reply 3');
    });

    it('should preserve system messages regardless of limit', () => {
      const messages: ChatMessage[] = [
        { role: 'system', content: 'You are a helpful assistant' },
        { role: 'user', content: 'Message 1' },
        { role: 'assistant', content: 'Reply 1' },
        { role: 'user', content: 'Message 2' },
        { role: 'assistant', content: 'Reply 2' },
        { role: 'user', content: 'Message 3' },
        { role: 'assistant', content: 'Reply 3' },
      ];

      const result = applyWindow(messages, 4);
      expect(result).toHaveLength(5); // 1 system + 4 conversation
      expect(result[0].role).toBe('system');
      expect(result[0].content).toBe('You are a helpful assistant');
    });

    it('should handle multiple system messages', () => {
      const messages: ChatMessage[] = [
        { role: 'system', content: 'System prompt 1' },
        { role: 'system', content: 'System prompt 2' },
        { role: 'user', content: 'Message 1' },
        { role: 'assistant', content: 'Reply 1' },
        { role: 'user', content: 'Message 2' },
        { role: 'assistant', content: 'Reply 2' },
      ];

      const result = applyWindow(messages, 2);
      expect(result).toHaveLength(4); // 2 system + 2 conversation
      expect(result.filter(m => m.role === 'system')).toHaveLength(2);
    });

    it('should handle empty messages array', () => {
      const result = applyWindow([], 10);
      expect(result).toHaveLength(0);
    });

    it('should handle only system messages', () => {
      const messages: ChatMessage[] = [
        { role: 'system', content: 'You are helpful' },
      ];

      const result = applyWindow(messages, 10);
      expect(result).toHaveLength(1);
      expect(result[0].role).toBe('system');
    });
  });

  describe('token estimation', () => {
    const estimateTokens = (messages: ChatMessage[]): number => {
      const totalChars = messages.reduce((sum, m) => sum + m.content.length, 0);
      return Math.ceil(totalChars / 4);
    };

    it('should estimate ~4 chars per token', () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'Hello world' }, // 11 chars
      ];

      const tokens = estimateTokens(messages);
      expect(tokens).toBe(3); // ceil(11/4) = 3
    });

    it('should sum all message contents', () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: '1234' }, // 4 chars
        { role: 'assistant', content: '1234' }, // 4 chars
      ];

      const tokens = estimateTokens(messages);
      expect(tokens).toBe(2); // 8 chars / 4 = 2 tokens
    });

    it('should return 0 for empty messages', () => {
      expect(estimateTokens([])).toBe(0);
    });
  });

  describe('statistics', () => {
    const getStats = (
      allMessages: ChatMessage[],
      windowedMessages: ChatMessage[],
      windowSize: number
    ) => {
      const estimateTokens = (msgs: ChatMessage[]): number => {
        const totalChars = msgs.reduce((sum, m) => sum + m.content.length, 0);
        return Math.ceil(totalChars / 4);
      };

      return {
        totalMessages: allMessages.length,
        windowedMessages: windowedMessages.length,
        trimmedMessages: allMessages.length - windowedMessages.length,
        estimatedTokens: estimateTokens(windowedMessages),
        windowSize,
      };
    };

    it('should calculate correct statistics', () => {
      const allMessages: ChatMessage[] = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi' },
        { role: 'user', content: 'Bye' },
        { role: 'assistant', content: 'Goodbye' },
      ];

      const windowedMessages = allMessages.slice(-2);

      const stats = getStats(allMessages, windowedMessages, 2);
      expect(stats.totalMessages).toBe(4);
      expect(stats.windowedMessages).toBe(2);
      expect(stats.trimmedMessages).toBe(2);
      expect(stats.windowSize).toBe(2);
    });
  });

  describe('window size validation', () => {
    const isValidWindowSize = (size: number): boolean => {
      return size > 0 && size <= 100;
    };

    it('should accept valid sizes between 1-100', () => {
      expect(isValidWindowSize(1)).toBe(true);
      expect(isValidWindowSize(20)).toBe(true);
      expect(isValidWindowSize(100)).toBe(true);
    });

    it('should reject zero or negative', () => {
      expect(isValidWindowSize(0)).toBe(false);
      expect(isValidWindowSize(-5)).toBe(false);
    });

    it('should reject sizes over 100', () => {
      expect(isValidWindowSize(101)).toBe(false);
      expect(isValidWindowSize(1000)).toBe(false);
    });
  });
});

