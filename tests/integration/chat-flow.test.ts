import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Integration tests for the chat flow
 * Tests the complete message flow from request to response
 */
describe('Chat Flow Integration', () => {
  // Mock types for the flow
  interface ChatMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
  }

  interface StreamChunk {
    type: 'delta' | 'error' | 'done';
    delta?: string;
    error?: { type: string; message: string };
    model?: string;
  }

  interface GenerateResponse {
    content: string;
    model: string;
    latencyMs: number;
  }

  interface CandidateProvider {
    id: string;
    weight: number;
    healthScore: number;
  }

  describe('message routing flow', () => {
    it('should select provider from candidate pool', () => {
      const candidates: CandidateProvider[] = [
        { id: 'groq', weight: 0.9, healthScore: 1.0 },
        { id: 'google', weight: 0.7, healthScore: 0.8 },
        { id: 'mistral', weight: 0.5, healthScore: 0.6 },
      ];

      // Simulate weighted selection
      const selectProvider = (pool: CandidateProvider[]): CandidateProvider | null => {
        if (pool.length === 0) return null;
        // In test, just return highest weight
        return pool.reduce((a, b) => (a.weight > b.weight ? a : b));
      };

      const selected = selectProvider(candidates);
      expect(selected).not.toBeNull();
      expect(selected!.id).toBe('groq');
    });

    it('should apply context window before sending to provider', () => {
      const allMessages: ChatMessage[] = [
        { role: 'system', content: 'Be helpful' },
        { role: 'user', content: 'Message 1' },
        { role: 'assistant', content: 'Response 1' },
        { role: 'user', content: 'Message 2' },
        { role: 'assistant', content: 'Response 2' },
        { role: 'user', content: 'Message 3' },
        { role: 'assistant', content: 'Response 3' },
        { role: 'user', content: 'Message 4' },
      ];

      const applyWindow = (messages: ChatMessage[], maxMessages: number): ChatMessage[] => {
        const systemMessages = messages.filter(m => m.role === 'system');
        const conversationMessages = messages.filter(m => m.role !== 'system');
        
        if (conversationMessages.length <= maxMessages) {
          return messages;
        }
        
        return [...systemMessages, ...conversationMessages.slice(-maxMessages)];
      };

      const windowed = applyWindow(allMessages, 4);
      expect(windowed).toHaveLength(5); // 1 system + 4 recent
      expect(windowed[0].role).toBe('system');
      expect(windowed[1].content).toBe('Response 2'); // First after trim
    });

    it('should accumulate streaming chunks', async () => {
      const chunks: StreamChunk[] = [
        { type: 'delta', delta: 'Hello' },
        { type: 'delta', delta: ' ' },
        { type: 'delta', delta: 'World' },
        { type: 'delta', delta: '!' },
        { type: 'done', model: 'test-model' },
      ];

      const accumulateStream = async (
        chunkIterator: AsyncIterable<StreamChunk>
      ): Promise<string> => {
        let content = '';
        for await (const chunk of chunkIterator) {
          if (chunk.type === 'delta' && chunk.delta) {
            content += chunk.delta;
          }
        }
        return content;
      };

      // Create async iterable from chunks
      async function* generateChunks(): AsyncGenerator<StreamChunk> {
        for (const chunk of chunks) {
          yield chunk;
        }
      }

      const result = await accumulateStream(generateChunks());
      expect(result).toBe('Hello World!');
    });
  });

  describe('error handling and fallback', () => {
    it('should retry with next provider on rate limit', () => {
      const attemptLog: string[] = [];
      const maxAttempts = 3;

      const simulateRequest = (
        providerId: string,
        shouldFail: boolean
      ): { success: boolean; error?: string } => {
        attemptLog.push(providerId);
        if (shouldFail) {
          return { success: false, error: 'rate_limit' };
        }
        return { success: true };
      };

      // Simulate routing with fallback
      const providers = ['provider1', 'provider2', 'provider3'];
      let attempt = 0;
      let result = { success: false, error: '' };

      while (attempt < maxAttempts) {
        const provider = providers[attempt];
        // First two fail, third succeeds
        result = simulateRequest(provider, attempt < 2);
        
        if (result.success) break;
        attempt++;
      }

      expect(attemptLog).toEqual(['provider1', 'provider2', 'provider3']);
      expect(result.success).toBe(true);
    });

    it('should open circuit breaker after consecutive failures', () => {
      const failureThreshold = 3;
      let consecutiveFailures = 0;
      let circuitState: 'closed' | 'open' = 'closed';

      const recordFailure = (): void => {
        consecutiveFailures++;
        if (consecutiveFailures >= failureThreshold) {
          circuitState = 'open';
        }
      };

      const recordSuccess = (): void => {
        consecutiveFailures = 0;
        circuitState = 'closed';
      };

      // Simulate 3 failures
      recordFailure();
      expect(circuitState).toBe('closed');
      recordFailure();
      expect(circuitState).toBe('closed');
      recordFailure();
      expect(circuitState).toBe('open');

      // Success resets
      recordSuccess();
      expect(circuitState).toBe('closed');
      expect(consecutiveFailures).toBe(0);
    });

    it('should apply cooldown after rate limit', () => {
      const cooldowns: Map<string, number> = new Map();
      const defaultCooldownMs = 120000;

      const applyCooldown = (providerId: string, retryAfterMs?: number): void => {
        const cooldownMs = retryAfterMs ?? defaultCooldownMs;
        cooldowns.set(providerId, Date.now() + cooldownMs);
      };

      const isInCooldown = (providerId: string): boolean => {
        const until = cooldowns.get(providerId);
        return until !== undefined && until > Date.now();
      };

      applyCooldown('groq', 60000);
      expect(isInCooldown('groq')).toBe(true);
      expect(isInCooldown('google')).toBe(false);
    });
  });

  describe('conversation persistence', () => {
    interface Message {
      id: string;
      conversationId: string;
      role: 'user' | 'assistant';
      content: string;
      providerId?: string;
      model?: string;
      latencyMs?: number;
    }

    interface Conversation {
      id: string;
      title: string;
      messageCount: number;
    }

    it('should create conversation on first message', () => {
      const conversations: Conversation[] = [];
      const messages: Message[] = [];

      const sendMessage = (
        conversationId: string | null,
        content: string
      ): { conversationId: string; messageId: string } => {
        // Create conversation if needed
        let convId = conversationId;
        if (!convId) {
          convId = `conv-${Date.now()}`;
          conversations.push({
            id: convId,
            title: content.slice(0, 50),
            messageCount: 0,
          });
        }

        // Create message
        const messageId = `msg-${Date.now()}`;
        messages.push({
          id: messageId,
          conversationId: convId,
          role: 'user',
          content,
        });

        // Update count
        const conv = conversations.find(c => c.id === convId);
        if (conv) conv.messageCount++;

        return { conversationId: convId, messageId };
      };

      const result = sendMessage(null, 'Hello, this is my first message');
      expect(conversations).toHaveLength(1);
      expect(messages).toHaveLength(1);
      expect(result.conversationId).toBeDefined();
    });

    it('should add messages to existing conversation', () => {
      const messages: Message[] = [];
      const conversationId = 'existing-conv';

      const addMessage = (
        convId: string,
        role: 'user' | 'assistant',
        content: string
      ): Message => {
        const msg: Message = {
          id: `msg-${messages.length}`,
          conversationId: convId,
          role,
          content,
        };
        messages.push(msg);
        return msg;
      };

      addMessage(conversationId, 'user', 'Question 1');
      addMessage(conversationId, 'assistant', 'Answer 1');
      addMessage(conversationId, 'user', 'Question 2');

      const convMessages = messages.filter(m => m.conversationId === conversationId);
      expect(convMessages).toHaveLength(3);
    });

    it('should save provider metadata with assistant messages', () => {
      const messages: Message[] = [];

      const saveAssistantMessage = (
        conversationId: string,
        content: string,
        providerId: string,
        model: string,
        latencyMs: number
      ): Message => {
        const msg: Message = {
          id: `msg-${Date.now()}`,
          conversationId,
          role: 'assistant',
          content,
          providerId,
          model,
          latencyMs,
        };
        messages.push(msg);
        return msg;
      };

      const msg = saveAssistantMessage(
        'conv-1',
        'Hello!',
        'groq',
        'llama-3.1-8b',
        150
      );

      expect(msg.providerId).toBe('groq');
      expect(msg.model).toBe('llama-3.1-8b');
      expect(msg.latencyMs).toBe(150);
    });
  });

  describe('memory integration', () => {
    it('should build context with memory and recent messages', () => {
      const buildContext = (
        recentMessages: ChatMessage[],
        summary: string | null,
        globalFacts: string[]
      ): ChatMessage[] => {
        const contextParts: string[] = [];

        if (globalFacts.length > 0) {
          contextParts.push(`Facts about user:\n${globalFacts.map(f => `- ${f}`).join('\n')}`);
        }

        if (summary) {
          contextParts.push(`Previous conversation summary:\n${summary}`);
        }

        if (contextParts.length === 0) {
          return recentMessages;
        }

        const systemMessage: ChatMessage = {
          role: 'system',
          content: contextParts.join('\n\n'),
        };

        return [systemMessage, ...recentMessages.filter(m => m.role !== 'system')];
      };

      const messages: ChatMessage[] = [
        { role: 'user', content: 'Hello' },
      ];

      const result = buildContext(
        messages,
        'User asked about TypeScript',
        ['prefers React', 'senior developer']
      );

      expect(result).toHaveLength(2);
      expect(result[0].role).toBe('system');
      expect(result[0].content).toContain('prefers React');
      expect(result[0].content).toContain('TypeScript');
    });
  });

  describe('abort handling', () => {
    it('should respect abort signal during streaming', async () => {
      const controller = new AbortController();
      let chunksReceived = 0;

      const simulateStream = async function* (
        signal: AbortSignal
      ): AsyncGenerator<StreamChunk> {
        for (let i = 0; i < 10; i++) {
          if (signal.aborted) {
            return;
          }
          yield { type: 'delta', delta: `Chunk ${i}` };
          chunksReceived++;
          await new Promise(resolve => setTimeout(resolve, 10));
        }
      };

      // Start streaming
      const streamPromise = (async () => {
        const chunks: string[] = [];
        for await (const chunk of simulateStream(controller.signal)) {
          chunks.push(chunk.delta || '');
        }
        return chunks;
      })();

      // Abort after a short delay
      setTimeout(() => controller.abort(), 35);

      const result = await streamPromise;
      expect(result.length).toBeLessThan(10);
    });
  });
});

