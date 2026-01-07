import { describe, it, expect } from 'vitest';

/**
 * Tests for base adapter error normalization
 */
describe('Base Provider Adapter', () => {
  // Simulate the normalizeError function from base adapter
  type NormalizedError =
    | { type: 'rate_limit'; retryAfterMs?: number; message: string }
    | { type: 'auth'; message: string }
    | { type: 'billing'; message: string }
    | { type: 'context_length'; maxTokens: number; message: string }
    | { type: 'content_filter'; message: string }
    | { type: 'server_error'; statusCode?: number; message: string }
    | { type: 'network'; message: string }
    | { type: 'unknown'; message: string };

  const normalizeError = (error: unknown, statusCode?: number): NormalizedError => {
    // Handle common HTTP status codes
    if (statusCode === 401 || statusCode === 403) {
      return { type: 'auth', message: 'Invalid or expired API key' };
    }
    if (statusCode === 402) {
      return { type: 'billing', message: 'Payment required or subscription issue' };
    }
    if (statusCode === 429) {
      return { type: 'rate_limit', message: 'Rate limit exceeded' };
    }
    if (statusCode && statusCode >= 500) {
      return { type: 'server_error', statusCode, message: 'Provider server error' };
    }

    // Handle error objects
    if (error instanceof Error) {
      const message = error.message.toLowerCase();

      if (
        message.includes('network') ||
        message.includes('fetch') ||
        message.includes('econnrefused')
      ) {
        return { type: 'network', message: error.message };
      }
      if (
        message.includes('rate') ||
        message.includes('limit') ||
        message.includes('quota')
      ) {
        return { type: 'rate_limit', message: error.message };
      }
      if (
        message.includes('auth') ||
        message.includes('key') ||
        message.includes('unauthorized')
      ) {
        return { type: 'auth', message: error.message };
      }
      if (
        message.includes('context') ||
        message.includes('token') ||
        message.includes('length')
      ) {
        return { type: 'context_length', maxTokens: 0, message: error.message };
      }
      if (
        message.includes('content') ||
        message.includes('filter') ||
        message.includes('safety')
      ) {
        return { type: 'content_filter', message: error.message };
      }

      return { type: 'unknown', message: error.message };
    }

    return { type: 'unknown', message: String(error) };
  };

  describe('status code handling', () => {
    it('should map 401 to auth error', () => {
      const result = normalizeError(new Error('Unauthorized'), 401);
      expect(result.type).toBe('auth');
    });

    it('should map 403 to auth error', () => {
      const result = normalizeError(new Error('Forbidden'), 403);
      expect(result.type).toBe('auth');
    });

    it('should map 402 to billing error', () => {
      const result = normalizeError(new Error('Payment Required'), 402);
      expect(result.type).toBe('billing');
    });

    it('should map 429 to rate_limit error', () => {
      const result = normalizeError(new Error('Too Many Requests'), 429);
      expect(result.type).toBe('rate_limit');
    });

    it('should map 500+ to server_error', () => {
      const result500 = normalizeError(new Error('Internal Error'), 500);
      expect(result500.type).toBe('server_error');
      expect((result500 as { statusCode: number }).statusCode).toBe(500);

      const result503 = normalizeError(new Error('Service Unavailable'), 503);
      expect(result503.type).toBe('server_error');
    });
  });

  describe('error message parsing', () => {
    it('should detect network errors', () => {
      const errors = [
        new Error('Network error occurred'),
        new Error('fetch failed'),
        new Error('ECONNREFUSED'),
      ];

      for (const error of errors) {
        expect(normalizeError(error).type).toBe('network');
      }
    });

    it('should detect rate limit errors', () => {
      const errors = [
        new Error('Rate limit exceeded'),
        new Error('Too many requests, quota exceeded'),
      ];

      for (const error of errors) {
        expect(normalizeError(error).type).toBe('rate_limit');
      }
    });

    it('should detect auth errors', () => {
      const errors = [
        new Error('Invalid API key'),
        new Error('Unauthorized access'),
        new Error('Authentication failed'),
      ];

      for (const error of errors) {
        expect(normalizeError(error).type).toBe('auth');
      }
    });

    it('should detect context length errors', () => {
      const errors = [
        new Error('Context too long'),
        new Error('Maximum token count exceeded'),
        new Error('Input length exceeded'),
      ];

      for (const error of errors) {
        expect(normalizeError(error).type).toBe('context_length');
      }
    });

    it('should detect content filter errors', () => {
      const errors = [
        new Error('Content filtered'),
        new Error('Safety filter triggered'),
        new Error('Content policy violation'),
      ];

      for (const error of errors) {
        expect(normalizeError(error).type).toBe('content_filter');
      }
    });

    it('should return unknown for unrecognized errors', () => {
      const error = new Error('Something completely different happened');
      expect(normalizeError(error).type).toBe('unknown');
    });
  });

  describe('non-Error handling', () => {
    it('should handle string errors', () => {
      const result = normalizeError('Something went wrong');
      expect(result.type).toBe('unknown');
      expect(result.message).toBe('Something went wrong');
    });

    it('should handle objects', () => {
      const result = normalizeError({ code: 'ERR', details: 'failed' });
      expect(result.type).toBe('unknown');
    });

    it('should handle null/undefined', () => {
      expect(normalizeError(null).type).toBe('unknown');
      expect(normalizeError(undefined).type).toBe('unknown');
    });
  });

  describe('stream chunk helpers', () => {
    interface UsageStats {
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
    }

    interface StreamChunk {
      type: 'delta' | 'error' | 'done';
      delta?: string;
      error?: NormalizedError;
      usage?: UsageStats;
      model?: string;
      finishReason?: 'stop' | 'length' | 'content_filter' | 'error';
    }

    const createErrorChunk = (error: NormalizedError): StreamChunk => {
      return { type: 'error', error };
    };

    const createDoneChunk = (
      usage: UsageStats,
      model: string,
      finishReason: StreamChunk['finishReason']
    ): StreamChunk => {
      return { type: 'done', usage, model, finishReason };
    };

    it('should create error chunk correctly', () => {
      const error: NormalizedError = { type: 'auth', message: 'Invalid key' };
      const chunk = createErrorChunk(error);

      expect(chunk.type).toBe('error');
      expect(chunk.error).toEqual(error);
    });

    it('should create done chunk correctly', () => {
      const usage: UsageStats = {
        promptTokens: 10,
        completionTokens: 20,
        totalTokens: 30,
      };

      const chunk = createDoneChunk(usage, 'gpt-4', 'stop');

      expect(chunk.type).toBe('done');
      expect(chunk.usage).toEqual(usage);
      expect(chunk.model).toBe('gpt-4');
      expect(chunk.finishReason).toBe('stop');
    });
  });

  describe('model selection', () => {
    const selectRandomModel = (
      availableModels: string[],
      defaultModel: string
    ): string => {
      if (availableModels.length === 0) {
        return defaultModel;
      }
      return availableModels[Math.floor(Math.random() * availableModels.length)];
    };

    it('should return default model when no models available', () => {
      const result = selectRandomModel([], 'default-model');
      expect(result).toBe('default-model');
    });

    it('should select from available models', () => {
      const models = ['model-a', 'model-b', 'model-c'];
      const result = selectRandomModel(models, 'default');
      expect(models).toContain(result);
    });

    it('should return single model when only one available', () => {
      const result = selectRandomModel(['only-model'], 'default');
      expect(result).toBe('only-model');
    });
  });
});

