import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';
import {
  BaseProviderAdapter,
  GenerateRequest,
  GenerateResponse,
  StreamChunk,
  ConnectionTestResult,
  NormalizedError,
  ProviderCapabilities,
  ChatMessage,
} from './base.js';
import { modelCacheService } from '../services/model-cache.service.js';

/**
 * Google AI (Gemini) Provider Adapter
 * 
 * Supports Gemini Pro, Gemini Flash with streaming.
 */
export class GoogleAdapter extends BaseProviderAdapter {
  readonly id = 'google' as const;
  readonly displayName = 'Google AI';

  readonly capabilities: ProviderCapabilities = {
    supportsStreaming: true,
    supportsSystemMessage: true,
    supportsFunctionCalling: true,
    supportsVision: true,
    maxContextTokens: 1000000,
    defaultModel: 'gemini-2.0-flash',
    availableModels: [
      'gemini-2.0-flash',
      'gemini-2.0-flash-lite',
      'gemini-1.5-pro',
      'gemini-1.5-flash',
    ],
  };

  private createClient(apiKey: string): GoogleGenerativeAI {
    return new GoogleGenerativeAI(apiKey);
  }

  private getModel(client: GoogleGenerativeAI, modelId: string, systemInstruction?: string): GenerativeModel {
    return client.getGenerativeModel({
      model: modelId,
      systemInstruction,
    });
  }

  async *generate(
    request: GenerateRequest,
    apiKey: string,
    signal?: AbortSignal
  ): AsyncGenerator<StreamChunk, GenerateResponse, undefined> {
    const client = this.createClient(apiKey);
    // Use cache-aware random model selection if no specific model requested
    const modelId = request.model || await modelCacheService.getRandomModel(this.id, apiKey);
    const startTime = Date.now();

    let fullContent = '';
    let promptTokens = 0;
    let completionTokens = 0;
    let finishReason: GenerateResponse['finishReason'] = 'stop';

    console.log(`[Google] Using model: ${modelId}`);

    try {
      // Extract system message if present
      const systemMessage = request.messages.find(m => m.role === 'system');
      const userMessages = request.messages.filter(m => m.role !== 'system');

      const model = this.getModel(client, modelId, systemMessage?.content);

      // Convert messages to Gemini format
      const history = this.convertToGeminiHistory(userMessages.slice(0, -1));
      const lastMessage = userMessages[userMessages.length - 1];

      const chat = model.startChat({
        history,
        generationConfig: {
          maxOutputTokens: request.maxTokens,
          temperature: request.temperature,
          stopSequences: request.stopSequences,
        },
      });

      const result = await chat.sendMessageStream(lastMessage.content);

      for await (const chunk of result.stream) {
        if (signal?.aborted) {
          break;
        }

        const text = chunk.text();
        if (text) {
          fullContent += text;
          yield { type: 'delta', delta: text };
        }
      }

      // Get final response for usage metadata
      const response = await result.response;
      const usageMetadata = response.usageMetadata;
      
      if (usageMetadata) {
        promptTokens = usageMetadata.promptTokenCount || 0;
        completionTokens = usageMetadata.candidatesTokenCount || 0;
      }

      // Check finish reason
      const candidate = response.candidates?.[0];
      if (candidate?.finishReason) {
        finishReason = this.mapFinishReason(candidate.finishReason);
      }

      const latencyMs = Date.now() - startTime;

      yield {
        type: 'done',
        usage: {
          promptTokens,
          completionTokens,
          totalTokens: promptTokens + completionTokens,
        },
        model: modelId,
        finishReason,
      };

      return {
        content: fullContent,
        model: modelId,
        usage: {
          promptTokens,
          completionTokens,
          totalTokens: promptTokens + completionTokens,
        },
        finishReason,
        latencyMs,
      };
    } catch (error) {
      const normalized = this.normalizeError(error);
      yield { type: 'error', error: normalized };
      throw error;
    }
  }

  async testConnection(apiKey: string): Promise<ConnectionTestResult> {
    const client = this.createClient(apiKey);
    const startTime = Date.now();

    try {
      const model = this.getModel(client, 'gemini-2.0-flash');
      await model.generateContent('Hi');

      return {
        success: true,
        latencyMs: Date.now() - startTime,
      };
    } catch (error) {
      const normalized = this.normalizeError(error);
      const latencyMs = Date.now() - startTime;

      // Rate limit errors mean the key IS valid, just quota is exhausted
      // Treat as success with a warning
      if (normalized.type === 'rate_limit') {
        console.log('[Google] API key valid but quota exceeded - treating as success');
        return {
          success: true,
          latencyMs,
          // Include warning in the response
        };
      }

      return {
        success: false,
        error: normalized,
        latencyMs,
      };
    }
  }

  normalizeError(error: unknown, statusCode?: number): NormalizedError {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();

      // Check for rate limit / quota errors FIRST (before auth check)
      // 429 errors and quota exhausted mean the key is valid but limit reached
      if (message.includes('429') || message.includes('quota') || message.includes('rate limit') || 
          message.includes('resource_exhausted') || message.includes('too many requests') ||
          message.includes('exceeded your current quota')) {
        // Extract retry delay if present
        const retryMatch = error.message.match(/retry in (\d+(?:\.\d+)?)/i);
        const retryAfterMs = retryMatch ? parseFloat(retryMatch[1]) * 1000 : undefined;
        return { type: 'rate_limit', retryAfterMs, message: error.message };
      }
      if (message.includes('api_key') || message.includes('invalid api key') || message.includes('api key not valid')) {
        return { type: 'auth', message: 'Invalid Google AI API key' };
      }
      if (message.includes('safety') || message.includes('blocked')) {
        return { type: 'content_filter', message: error.message };
      }
      if (message.includes('token') || message.includes('context')) {
        return { type: 'context_length', maxTokens: 0, message: error.message };
      }
    }

    return super.normalizeError(error, statusCode);
  }

  private convertToGeminiHistory(messages: ChatMessage[]): Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> {
    return messages.map(m => ({
      role: m.role === 'assistant' ? 'model' as const : 'user' as const,
      parts: [{ text: m.content }],
    }));
  }

  private mapFinishReason(reason: string): GenerateResponse['finishReason'] {
    switch (reason) {
      case 'STOP':
        return 'stop';
      case 'MAX_TOKENS':
        return 'length';
      case 'SAFETY':
        return 'content_filter';
      default:
        return 'stop';
    }
  }
}

// Export singleton instance
export const googleAdapter = new GoogleAdapter();

