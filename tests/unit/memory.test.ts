import { describe, it, expect, vi } from 'vitest';

/**
 * Tests for memory service - conversation summarization and fact extraction
 */
describe('Memory Service', () => {
  interface ChatMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
  }

  interface ConversationMemory {
    conversationId: string;
    summary: string | null;
    keyFacts: string[];
    lastSummarizedAt: string | null;
    messageCountAtSummary: number | null;
    lastSummarizedMessageId: string | null;
  }

  describe('summarization threshold', () => {
    const needsSummary = (
      currentMessageCount: number,
      lastSummarizedCount: number | null,
      threshold: number
    ): boolean => {
      const messagesSinceSummary = currentMessageCount - (lastSummarizedCount ?? 0);
      return messagesSinceSummary >= threshold;
    };

    it('should trigger summary when threshold reached', () => {
      expect(needsSummary(10, 0, 10)).toBe(true);
      expect(needsSummary(15, 5, 10)).toBe(true);
    });

    it('should not trigger before threshold', () => {
      expect(needsSummary(5, 0, 10)).toBe(false);
      expect(needsSummary(10, 5, 10)).toBe(false);
    });

    it('should handle null last summarized count', () => {
      expect(needsSummary(10, null, 10)).toBe(true);
      expect(needsSummary(5, null, 10)).toBe(false);
    });
  });

  describe('memory context building', () => {
    const buildMemoryPrompt = (
      summary: string | null,
      keyFacts: string[]
    ): string => {
      const parts: string[] = [];

      if (summary) {
        parts.push(`## Previous Conversation Summary\n${summary}`);
      }

      if (keyFacts && keyFacts.length > 0) {
        parts.push(
          `## Key Facts About This User\n${keyFacts.map(f => `- ${f}`).join('\n')}`
        );
      }

      return parts.join('\n\n');
    };

    it('should build prompt with summary only', () => {
      const prompt = buildMemoryPrompt('User asked about TypeScript', []);
      expect(prompt).toContain('## Previous Conversation Summary');
      expect(prompt).toContain('User asked about TypeScript');
      expect(prompt).not.toContain('Key Facts');
    });

    it('should build prompt with facts only', () => {
      const prompt = buildMemoryPrompt(null, ['prefers TypeScript', 'works on React']);
      expect(prompt).not.toContain('Summary');
      expect(prompt).toContain('## Key Facts About This User');
      expect(prompt).toContain('- prefers TypeScript');
      expect(prompt).toContain('- works on React');
    });

    it('should build prompt with both summary and facts', () => {
      const prompt = buildMemoryPrompt('Discussion about coding', [
        'uses VSCode',
      ]);
      expect(prompt).toContain('## Previous Conversation Summary');
      expect(prompt).toContain('## Key Facts About This User');
    });

    it('should return empty string when no memory', () => {
      const prompt = buildMemoryPrompt(null, []);
      expect(prompt).toBe('');
    });
  });

  describe('context integration', () => {
    const buildContext = (
      messages: ChatMessage[],
      memory: ConversationMemory | null,
      globalFacts: string[]
    ): ChatMessage[] => {
      const hasMemory =
        memory?.summary || (memory?.keyFacts && memory.keyFacts.length > 0);
      const hasFacts = globalFacts.length > 0;

      if (!hasMemory && !hasFacts) {
        return messages;
      }

      // Build context parts
      const contextParts: string[] = [];

      if (hasFacts) {
        contextParts.push(
          `## What You Know About the User\n${globalFacts.map(f => `- ${f}`).join('\n')}`
        );
      }

      if (hasMemory) {
        const parts: string[] = [];
        if (memory!.summary) {
          parts.push(`## Previous Conversation Summary\n${memory!.summary}`);
        }
        if (memory!.keyFacts.length > 0) {
          parts.push(
            `## Key Facts From This Conversation\n${memory!.keyFacts.map(f => `- ${f}`).join('\n')}`
          );
        }
        contextParts.push(parts.join('\n\n'));
      }

      const fullContext = contextParts.join('\n\n');

      // Separate existing system messages
      const systemMessages = messages.filter(m => m.role === 'system');
      const conversationMessages = messages.filter(m => m.role !== 'system');

      const enhancedSystemMessage: ChatMessage = {
        role: 'system',
        content:
          systemMessages.length > 0
            ? `${systemMessages.map(m => m.content).join('\n')}\n\n${fullContext}`
            : fullContext,
      };

      return [enhancedSystemMessage, ...conversationMessages];
    };

    it('should return original messages when no context', () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi!' },
      ];

      const result = buildContext(messages, null, []);
      expect(result).toEqual(messages);
    });

    it('should prepend global facts as system message', () => {
      const messages: ChatMessage[] = [{ role: 'user', content: 'Hello' }];

      const result = buildContext(messages, null, ['user name is John']);
      expect(result).toHaveLength(2);
      expect(result[0].role).toBe('system');
      expect(result[0].content).toContain('user name is John');
    });

    it('should merge with existing system message', () => {
      const messages: ChatMessage[] = [
        { role: 'system', content: 'You are helpful' },
        { role: 'user', content: 'Hello' },
      ];

      const result = buildContext(messages, null, ['prefers Python']);
      expect(result).toHaveLength(2);
      expect(result[0].role).toBe('system');
      expect(result[0].content).toContain('You are helpful');
      expect(result[0].content).toContain('prefers Python');
    });

    it('should include both memory and global facts', () => {
      const messages: ChatMessage[] = [{ role: 'user', content: 'Hello' }];

      const memory: ConversationMemory = {
        conversationId: 'test',
        summary: 'Previous discussion about React',
        keyFacts: ['likes functional components'],
        lastSummarizedAt: null,
        messageCountAtSummary: 10,
        lastSummarizedMessageId: null,
      };

      const result = buildContext(messages, memory, ['senior developer']);
      expect(result[0].content).toContain('senior developer');
      expect(result[0].content).toContain('Previous discussion about React');
      expect(result[0].content).toContain('likes functional components');
    });
  });

  describe('key fact management', () => {
    const addKeyFact = (existing: string[], newFact: string): string[] => {
      if (existing.includes(newFact)) return existing;
      return [...existing, newFact];
    };

    const removeKeyFact = (facts: string[], toRemove: string): string[] => {
      return facts.filter(f => f !== toRemove);
    };

    it('should add new fact', () => {
      const facts = ['fact 1'];
      const result = addKeyFact(facts, 'fact 2');
      expect(result).toEqual(['fact 1', 'fact 2']);
    });

    it('should not duplicate existing fact', () => {
      const facts = ['fact 1'];
      const result = addKeyFact(facts, 'fact 1');
      expect(result).toEqual(['fact 1']);
    });

    it('should remove fact', () => {
      const facts = ['fact 1', 'fact 2', 'fact 3'];
      const result = removeKeyFact(facts, 'fact 2');
      expect(result).toEqual(['fact 1', 'fact 3']);
    });

    it('should handle removing non-existent fact', () => {
      const facts = ['fact 1'];
      const result = removeKeyFact(facts, 'fact 2');
      expect(result).toEqual(['fact 1']);
    });
  });

  describe('JSON fact extraction parsing', () => {
    const extractFactsFromResponse = (response: string): string[] => {
      try {
        const cleaned = response.trim();
        const match = cleaned.match(/\[[\s\S]*\]/);
        if (match) {
          const parsed = JSON.parse(match[0]);
          if (Array.isArray(parsed)) {
            return parsed.filter(
              (item): item is string => typeof item === 'string'
            );
          }
        }
      } catch {
        // Invalid JSON
      }
      return [];
    };

    it('should parse clean JSON array', () => {
      const response = '["fact 1", "fact 2", "fact 3"]';
      expect(extractFactsFromResponse(response)).toEqual([
        'fact 1',
        'fact 2',
        'fact 3',
      ]);
    });

    it('should handle JSON with surrounding text', () => {
      const response =
        'Here are the facts:\n["fact 1", "fact 2"]\nThese were extracted.';
      expect(extractFactsFromResponse(response)).toEqual(['fact 1', 'fact 2']);
    });

    it('should handle multiline JSON', () => {
      const response = `[
        "fact 1",
        "fact 2"
      ]`;
      expect(extractFactsFromResponse(response)).toEqual(['fact 1', 'fact 2']);
    });

    it('should return empty array for invalid JSON', () => {
      expect(extractFactsFromResponse('not json')).toEqual([]);
      expect(extractFactsFromResponse('[invalid')).toEqual([]);
    });

    it('should filter non-string values', () => {
      const response = '["valid", 123, null, "also valid"]';
      const result = extractFactsFromResponse(response);
      expect(result).toEqual(['valid', 'also valid']);
    });
  });

  describe('provider selection for summarization', () => {
    interface ProviderKey {
      id: string;
      hasKey: boolean;
    }

    const getAvailableProvider = (
      providers: ProviderKey[],
      preferredOrder: string[]
    ): string | null => {
      for (const id of preferredOrder) {
        const provider = providers.find(p => p.id === id);
        if (provider?.hasKey) {
          return id;
        }
      }
      return null;
    };

    const preferredOrder = ['groq', 'cerebras', 'mistral', 'cohere', 'google'];

    it('should select first available preferred provider', () => {
      const providers: ProviderKey[] = [
        { id: 'google', hasKey: true },
        { id: 'groq', hasKey: true },
        { id: 'mistral', hasKey: false },
      ];

      expect(getAvailableProvider(providers, preferredOrder)).toBe('groq');
    });

    it('should skip providers without keys', () => {
      const providers: ProviderKey[] = [
        { id: 'groq', hasKey: false },
        { id: 'cerebras', hasKey: false },
        { id: 'mistral', hasKey: true },
      ];

      expect(getAvailableProvider(providers, preferredOrder)).toBe('mistral');
    });

    it('should return null when no providers available', () => {
      const providers: ProviderKey[] = [
        { id: 'groq', hasKey: false },
        { id: 'cerebras', hasKey: false },
      ];

      expect(getAvailableProvider(providers, preferredOrder)).toBeNull();
    });
  });
});

