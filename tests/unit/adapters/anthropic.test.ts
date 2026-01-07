import { describe, it, expect } from 'vitest';

/**
 * Tests for Anthropic adapter specifics
 */
describe('Anthropic Adapter', () => {
  describe('message format conversion', () => {
    interface StandardMessage {
      role: 'user' | 'assistant' | 'system';
      content: string;
    }

    interface AnthropicMessage {
      role: 'user' | 'assistant';
      content: string;
    }

    interface AnthropicRequest {
      model: string;
      messages: AnthropicMessage[];
      system?: string;
      max_tokens: number;
      stream: boolean;
    }

    const convertToAnthropicFormat = (
      messages: StandardMessage[],
      model: string,
      maxTokens: number
    ): AnthropicRequest => {
      // Extract system message
      const systemMessages = messages.filter(m => m.role === 'system');
      const systemPrompt = systemMessages.map(m => m.content).join('\n');

      // Convert other messages
      const anthropicMessages: AnthropicMessage[] = messages
        .filter(m => m.role !== 'system')
        .map(m => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        }));

      const request: AnthropicRequest = {
        model,
        messages: anthropicMessages,
        max_tokens: maxTokens,
        stream: true,
      };

      if (systemPrompt) {
        request.system = systemPrompt;
      }

      return request;
    };

    it('should extract system message into system field', () => {
      const messages: StandardMessage[] = [
        { role: 'system', content: 'You are helpful' },
        { role: 'user', content: 'Hello' },
      ];

      const result = convertToAnthropicFormat(messages, 'claude-3', 1000);
      expect(result.system).toBe('You are helpful');
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].role).toBe('user');
    });

    it('should combine multiple system messages', () => {
      const messages: StandardMessage[] = [
        { role: 'system', content: 'Be helpful' },
        { role: 'system', content: 'Be concise' },
        { role: 'user', content: 'Hello' },
      ];

      const result = convertToAnthropicFormat(messages, 'claude-3', 1000);
      expect(result.system).toBe('Be helpful\nBe concise');
    });

    it('should omit system field when no system messages', () => {
      const messages: StandardMessage[] = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi!' },
      ];

      const result = convertToAnthropicFormat(messages, 'claude-3', 1000);
      expect(result.system).toBeUndefined();
    });

    it('should preserve message order', () => {
      const messages: StandardMessage[] = [
        { role: 'user', content: 'First' },
        { role: 'assistant', content: 'Response' },
        { role: 'user', content: 'Second' },
      ];

      const result = convertToAnthropicFormat(messages, 'claude-3', 1000);
      expect(result.messages).toHaveLength(3);
      expect(result.messages[0].content).toBe('First');
      expect(result.messages[1].content).toBe('Response');
      expect(result.messages[2].content).toBe('Second');
    });
  });

  describe('Anthropic stream event parsing', () => {
    type AnthropicEvent =
      | { type: 'message_start'; message: { id: string; model: string } }
      | { type: 'content_block_start'; index: number }
      | { type: 'content_block_delta'; delta: { type: 'text_delta'; text: string } }
      | { type: 'content_block_stop'; index: number }
      | { type: 'message_delta'; delta: { stop_reason: string }; usage: { output_tokens: number } }
      | { type: 'message_stop' };

    const extractTextDelta = (event: AnthropicEvent): string | null => {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        return event.delta.text;
      }
      return null;
    };

    const isStreamComplete = (event: AnthropicEvent): boolean => {
      return event.type === 'message_stop';
    };

    it('should extract text from content_block_delta', () => {
      const event: AnthropicEvent = {
        type: 'content_block_delta',
        delta: { type: 'text_delta', text: 'Hello' },
      };

      expect(extractTextDelta(event)).toBe('Hello');
    });

    it('should return null for non-delta events', () => {
      const events: AnthropicEvent[] = [
        { type: 'message_start', message: { id: '123', model: 'claude' } },
        { type: 'content_block_start', index: 0 },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_stop' },
      ];

      for (const event of events) {
        expect(extractTextDelta(event)).toBeNull();
      }
    });

    it('should detect stream completion', () => {
      expect(isStreamComplete({ type: 'message_stop' })).toBe(true);
      expect(isStreamComplete({ type: 'message_start', message: { id: '1', model: 'm' } })).toBe(false);
    });
  });

  describe('Anthropic error handling', () => {
    interface AnthropicError {
      type: 'error';
      error: {
        type: 'invalid_request_error' | 'authentication_error' | 'rate_limit_error' | 'api_error' | 'overloaded_error';
        message: string;
      };
    }

    type NormalizedErrorType = 'auth' | 'rate_limit' | 'server_error' | 'unknown';

    const mapAnthropicError = (error: AnthropicError['error']): NormalizedErrorType => {
      switch (error.type) {
        case 'authentication_error':
          return 'auth';
        case 'rate_limit_error':
          return 'rate_limit';
        case 'api_error':
        case 'overloaded_error':
          return 'server_error';
        case 'invalid_request_error':
        default:
          return 'unknown';
      }
    };

    it('should map authentication_error to auth', () => {
      expect(
        mapAnthropicError({ type: 'authentication_error', message: 'Invalid key' })
      ).toBe('auth');
    });

    it('should map rate_limit_error to rate_limit', () => {
      expect(
        mapAnthropicError({ type: 'rate_limit_error', message: 'Too many requests' })
      ).toBe('rate_limit');
    });

    it('should map api_error to server_error', () => {
      expect(
        mapAnthropicError({ type: 'api_error', message: 'Internal error' })
      ).toBe('server_error');
    });

    it('should map overloaded_error to server_error', () => {
      expect(
        mapAnthropicError({ type: 'overloaded_error', message: 'Overloaded' })
      ).toBe('server_error');
    });

    it('should map invalid_request_error to unknown', () => {
      expect(
        mapAnthropicError({ type: 'invalid_request_error', message: 'Bad request' })
      ).toBe('unknown');
    });
  });

  describe('Anthropic-specific headers', () => {
    const ANTHROPIC_VERSION = '2023-06-01';

    const getAnthropicHeaders = (apiKey: string): Record<string, string> => {
      return {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      };
    };

    it('should use x-api-key header', () => {
      const headers = getAnthropicHeaders('test-key');
      expect(headers['x-api-key']).toBe('test-key');
      expect(headers['Authorization']).toBeUndefined();
    });

    it('should include anthropic-version', () => {
      const headers = getAnthropicHeaders('test-key');
      expect(headers['anthropic-version']).toBe(ANTHROPIC_VERSION);
    });
  });

  describe('model validation', () => {
    const VALID_CLAUDE_MODELS = [
      'claude-3-5-sonnet-latest',
      'claude-3-5-sonnet-20241022',
      'claude-3-5-haiku-latest',
      'claude-3-opus-latest',
      'claude-3-sonnet-20240229',
      'claude-3-haiku-20240307',
    ];

    const isValidClaudeModel = (model: string): boolean => {
      return VALID_CLAUDE_MODELS.includes(model) || model.startsWith('claude-');
    };

    it('should accept known Claude models', () => {
      for (const model of VALID_CLAUDE_MODELS) {
        expect(isValidClaudeModel(model)).toBe(true);
      }
    });

    it('should accept claude-* prefixed models', () => {
      expect(isValidClaudeModel('claude-4-opus')).toBe(true);
      expect(isValidClaudeModel('claude-future-model')).toBe(true);
    });

    it('should reject non-Claude models', () => {
      expect(isValidClaudeModel('gpt-4')).toBe(false);
      expect(isValidClaudeModel('llama-3')).toBe(false);
    });
  });
});

