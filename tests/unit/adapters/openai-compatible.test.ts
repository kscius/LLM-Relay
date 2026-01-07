import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Tests for OpenAI-compatible API adapters
 * (OpenAI, Together, DeepSeek, xAI, Groq, OpenRouter)
 */
describe('OpenAI-Compatible Adapters', () => {
  // Mock response format from OpenAI-compatible APIs
  interface ChatCompletionChunk {
    id: string;
    object: 'chat.completion.chunk';
    created: number;
    model: string;
    choices: Array<{
      index: number;
      delta: {
        role?: string;
        content?: string;
      };
      finish_reason: 'stop' | 'length' | 'content_filter' | null;
    }>;
    usage?: {
      prompt_tokens: number;
      completion_tokens: number;
      total_tokens: number;
    };
  }

  describe('SSE stream parsing', () => {
    const parseSSELine = (line: string): ChatCompletionChunk | null | 'done' => {
      const trimmed = line.trim();
      
      if (!trimmed.startsWith('data: ')) {
        return null;
      }

      const data = trimmed.slice(6); // Remove 'data: ' prefix

      if (data === '[DONE]') {
        return 'done';
      }

      try {
        return JSON.parse(data) as ChatCompletionChunk;
      } catch {
        return null;
      }
    };

    it('should parse valid SSE data line', () => {
      const line = 'data: {"id":"123","object":"chat.completion.chunk","created":1234,"model":"gpt-4","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}';
      const result = parseSSELine(line);
      
      expect(result).not.toBeNull();
      expect(result).not.toBe('done');
      expect((result as ChatCompletionChunk).id).toBe('123');
      expect((result as ChatCompletionChunk).choices[0].delta.content).toBe('Hello');
    });

    it('should detect [DONE] marker', () => {
      expect(parseSSELine('data: [DONE]')).toBe('done');
    });

    it('should ignore empty lines', () => {
      expect(parseSSELine('')).toBeNull();
      expect(parseSSELine('   ')).toBeNull();
    });

    it('should ignore non-data lines', () => {
      expect(parseSSELine('event: message')).toBeNull();
      expect(parseSSELine('id: 12345')).toBeNull();
      expect(parseSSELine(': comment')).toBeNull();
    });

    it('should handle invalid JSON gracefully', () => {
      expect(parseSSELine('data: {invalid json}')).toBeNull();
    });
  });

  describe('content accumulation', () => {
    const accumulateContent = (chunks: Array<{ content?: string }>): string => {
      return chunks.map(c => c.content || '').join('');
    };

    it('should accumulate multiple content chunks', () => {
      const chunks = [
        { content: 'Hello' },
        { content: ' ' },
        { content: 'World' },
        { content: '!' },
      ];

      expect(accumulateContent(chunks)).toBe('Hello World!');
    });

    it('should handle undefined content', () => {
      const chunks = [
        { content: 'Hello' },
        { content: undefined },
        { content: 'World' },
      ];

      expect(accumulateContent(chunks)).toBe('HelloWorld');
    });

    it('should handle empty chunks array', () => {
      expect(accumulateContent([])).toBe('');
    });
  });

  describe('usage stats extraction', () => {
    interface OpenAIUsage {
      prompt_tokens: number;
      completion_tokens: number;
      total_tokens: number;
    }

    interface UsageStats {
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
    }

    const normalizeUsage = (usage: OpenAIUsage | undefined): UsageStats => {
      return {
        promptTokens: usage?.prompt_tokens ?? 0,
        completionTokens: usage?.completion_tokens ?? 0,
        totalTokens: usage?.total_tokens ?? 0,
      };
    };

    it('should normalize OpenAI usage format', () => {
      const openaiUsage: OpenAIUsage = {
        prompt_tokens: 100,
        completion_tokens: 50,
        total_tokens: 150,
      };

      const result = normalizeUsage(openaiUsage);
      expect(result).toEqual({
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
      });
    });

    it('should handle undefined usage', () => {
      const result = normalizeUsage(undefined);
      expect(result).toEqual({
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
      });
    });
  });

  describe('finish reason mapping', () => {
    type OpenAIFinishReason = 'stop' | 'length' | 'content_filter' | 'function_call' | 'tool_calls' | null;
    type NormalizedFinishReason = 'stop' | 'length' | 'content_filter' | 'error';

    const mapFinishReason = (reason: OpenAIFinishReason): NormalizedFinishReason => {
      if (!reason) return 'stop';
      if (reason === 'stop' || reason === 'length' || reason === 'content_filter') {
        return reason;
      }
      return 'stop'; // function_call, tool_calls -> stop
    };

    it('should pass through standard reasons', () => {
      expect(mapFinishReason('stop')).toBe('stop');
      expect(mapFinishReason('length')).toBe('length');
      expect(mapFinishReason('content_filter')).toBe('content_filter');
    });

    it('should map null to stop', () => {
      expect(mapFinishReason(null)).toBe('stop');
    });

    it('should map function_call to stop', () => {
      expect(mapFinishReason('function_call')).toBe('stop');
      expect(mapFinishReason('tool_calls')).toBe('stop');
    });
  });

  describe('request body construction', () => {
    interface ChatMessage {
      role: 'user' | 'assistant' | 'system';
      content: string;
    }

    interface GenerateRequest {
      messages: ChatMessage[];
      model?: string;
      maxTokens?: number;
      temperature?: number;
    }

    const buildRequestBody = (
      request: GenerateRequest,
      defaultModel: string
    ): Record<string, unknown> => {
      return {
        model: request.model || defaultModel,
        messages: request.messages,
        stream: true,
        max_tokens: request.maxTokens,
        temperature: request.temperature,
      };
    };

    it('should use provided model', () => {
      const request: GenerateRequest = {
        messages: [{ role: 'user', content: 'Hi' }],
        model: 'custom-model',
      };

      const body = buildRequestBody(request, 'default-model');
      expect(body.model).toBe('custom-model');
    });

    it('should fallback to default model', () => {
      const request: GenerateRequest = {
        messages: [{ role: 'user', content: 'Hi' }],
      };

      const body = buildRequestBody(request, 'default-model');
      expect(body.model).toBe('default-model');
    });

    it('should include optional parameters when provided', () => {
      const request: GenerateRequest = {
        messages: [{ role: 'user', content: 'Hi' }],
        maxTokens: 100,
        temperature: 0.7,
      };

      const body = buildRequestBody(request, 'model');
      expect(body.max_tokens).toBe(100);
      expect(body.temperature).toBe(0.7);
    });

    it('should always enable streaming', () => {
      const request: GenerateRequest = {
        messages: [{ role: 'user', content: 'Hi' }],
      };

      const body = buildRequestBody(request, 'model');
      expect(body.stream).toBe(true);
    });
  });

  describe('provider-specific headers', () => {
    const getHeaders = (
      apiKey: string,
      provider: 'openai' | 'openrouter' | 'together' | 'deepseek' | 'xai'
    ): Record<string, string> => {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      };

      if (provider === 'openrouter') {
        headers['HTTP-Referer'] = 'https://llm-relay.app';
        headers['X-Title'] = 'LLM Relay';
      }

      return headers;
    };

    it('should include standard headers for all providers', () => {
      const providers: Array<'openai' | 'together' | 'deepseek' | 'xai'> = [
        'openai',
        'together',
        'deepseek',
        'xai',
      ];

      for (const provider of providers) {
        const headers = getHeaders('test-key', provider);
        expect(headers['Content-Type']).toBe('application/json');
        expect(headers['Authorization']).toBe('Bearer test-key');
      }
    });

    it('should include OpenRouter-specific headers', () => {
      const headers = getHeaders('test-key', 'openrouter');
      expect(headers['HTTP-Referer']).toBe('https://llm-relay.app');
      expect(headers['X-Title']).toBe('LLM Relay');
    });
  });

  describe('error detection from response', () => {
    interface ErrorResponse {
      error?: {
        message: string;
        type?: string;
        code?: string;
      };
    }

    const hasError = (response: ErrorResponse): boolean => {
      return response.error !== undefined;
    };

    const getErrorMessage = (response: ErrorResponse): string => {
      return response.error?.message || 'Unknown error';
    };

    it('should detect error in response', () => {
      const response: ErrorResponse = {
        error: {
          message: 'Invalid API key',
          type: 'invalid_request_error',
        },
      };

      expect(hasError(response)).toBe(true);
      expect(getErrorMessage(response)).toBe('Invalid API key');
    });

    it('should handle response without error', () => {
      const response: ErrorResponse = {};
      expect(hasError(response)).toBe(false);
      expect(getErrorMessage(response)).toBe('Unknown error');
    });
  });
});

