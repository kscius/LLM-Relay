import { describe, it, expect } from 'vitest';

// Test export functionality
describe('Export Functions', () => {
  interface Message {
    id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    createdAt: number;
    providerId?: string;
    model?: string;
  }

  interface Conversation {
    id: string;
    title: string;
    createdAt: number;
    updatedAt: number;
    messageCount?: number;
  }

  describe('exportAsMarkdown', () => {
    const exportAsMarkdown = (conversation: Conversation, messages: Message[]): string => {
      const lines: string[] = [];
      lines.push(`# ${conversation.title}`);
      lines.push('');
      lines.push('---');
      lines.push('');

      for (const message of messages) {
        const role = message.role === 'user' ? '**You**' : '**Assistant**';
        lines.push(`### ${role}`);
        if (message.providerId) {
          lines.push(`*via ${message.providerId}${message.model ? ` (${message.model})` : ''}*`);
        }
        lines.push('');
        lines.push(message.content);
        lines.push('');
        lines.push('---');
        lines.push('');
      }

      return lines.join('\n');
    };

    it('should include conversation title', () => {
      const conversation: Conversation = {
        id: '1',
        title: 'Test Conversation',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const result = exportAsMarkdown(conversation, []);
      expect(result).toContain('# Test Conversation');
    });

    it('should format user messages correctly', () => {
      const conversation: Conversation = {
        id: '1',
        title: 'Test',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const messages: Message[] = [
        { id: '1', role: 'user', content: 'Hello world', createdAt: Date.now() },
      ];

      const result = exportAsMarkdown(conversation, messages);
      expect(result).toContain('**You**');
      expect(result).toContain('Hello world');
    });

    it('should include provider info for assistant messages', () => {
      const conversation: Conversation = {
        id: '1',
        title: 'Test',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const messages: Message[] = [
        {
          id: '1',
          role: 'assistant',
          content: 'Hi there',
          createdAt: Date.now(),
          providerId: 'openai',
          model: 'gpt-4o',
        },
      ];

      const result = exportAsMarkdown(conversation, messages);
      expect(result).toContain('**Assistant**');
      expect(result).toContain('via openai');
      expect(result).toContain('gpt-4o');
    });
  });

  describe('exportAsJson', () => {
    const exportAsJson = (
      conversation: Conversation,
      messages: Message[],
      includeMetadata: boolean = true
    ): object => {
      return {
        conversation: {
          id: conversation.id,
          title: conversation.title,
          createdAt: new Date(conversation.createdAt).toISOString(),
          updatedAt: new Date(conversation.updatedAt).toISOString(),
        },
        messages: messages.map(m => ({
          id: m.id,
          role: m.role,
          content: m.content,
          createdAt: new Date(m.createdAt).toISOString(),
          ...(includeMetadata && m.providerId && {
            providerId: m.providerId,
            model: m.model,
          }),
        })),
      };
    };

    it('should include conversation metadata', () => {
      const conversation: Conversation = {
        id: '123',
        title: 'Test Conv',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const result = exportAsJson(conversation, []);
      expect(result.conversation.id).toBe('123');
      expect(result.conversation.title).toBe('Test Conv');
    });

    it('should include messages', () => {
      const conversation: Conversation = {
        id: '1',
        title: 'Test',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const messages: Message[] = [
        { id: 'm1', role: 'user', content: 'Hello', createdAt: Date.now() },
        { id: 'm2', role: 'assistant', content: 'Hi', createdAt: Date.now(), providerId: 'openai' },
      ];

      const result = exportAsJson(conversation, messages);
      expect(result.messages).toHaveLength(2);
      expect(result.messages[0].role).toBe('user');
      expect(result.messages[1].role).toBe('assistant');
    });

    it('should optionally exclude metadata', () => {
      const conversation: Conversation = {
        id: '1',
        title: 'Test',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const messages: Message[] = [
        { id: 'm1', role: 'assistant', content: 'Hi', createdAt: Date.now(), providerId: 'openai', model: 'gpt-4' },
      ];

      const withMeta = exportAsJson(conversation, messages, true);
      const withoutMeta = exportAsJson(conversation, messages, false);

      expect(withMeta.messages[0].providerId).toBe('openai');
      expect(withoutMeta.messages[0].providerId).toBeUndefined();
    });
  });

  describe('filename sanitization', () => {
    const sanitizeFilename = (title: string): string => {
      return title
        .replace(/[^a-z0-9]/gi, '_')
        .toLowerCase()
        .slice(0, 50);
    };

    it('should replace special characters with underscores', () => {
      expect(sanitizeFilename('Hello World!')).toBe('hello_world_');
    });

    it('should convert to lowercase', () => {
      expect(sanitizeFilename('UPPERCASE')).toBe('uppercase');
    });

    it('should truncate long titles', () => {
      const longTitle = 'a'.repeat(100);
      expect(sanitizeFilename(longTitle).length).toBe(50);
    });

    it('should handle special characters', () => {
      expect(sanitizeFilename('Test: With/Slashes\\And?Stuff')).toBe('test__with_slashes_and_stuff');
    });
  });
});

