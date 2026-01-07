// Google AI (Gemini) adapter

import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';
import {
  BaseProviderAdapter, GenerateRequest, GenerateResponse, StreamChunk,
  ConnectionTestResult, NormalizedError, ProviderCapabilities, ChatMessage,
} from './base.js';
import { modelCacheService } from '../services/model-cache.service.js';

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
    availableModels: ['gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-1.5-pro', 'gemini-1.5-flash'],
  };

  private createClient(key: string): GoogleGenerativeAI {
    return new GoogleGenerativeAI(key);
  }

  private getModel(client: GoogleGenerativeAI, id: string, sysInstruction?: string): GenerativeModel {
    return client.getGenerativeModel({ model: id, systemInstruction: sysInstruction });
  }

  async *generate(req: GenerateRequest, apiKey: string, signal?: AbortSignal): AsyncGenerator<StreamChunk, GenerateResponse, undefined> {
    const client = this.createClient(apiKey);
    const modelId = req.model || await modelCacheService.getRandomModel(this.id, apiKey);
    const t0 = Date.now();

    let content = '';
    let promptTok = 0, compTok = 0;
    let finish: GenerateResponse['finishReason'] = 'stop';

    console.log('google:', modelId);

    try {
      const sysMsgs = req.messages.find(m => m.role === 'system');
      const userMsgs = req.messages.filter(m => m.role !== 'system');

      const model = this.getModel(client, modelId, sysMsgs?.content);
      const history = this.toGeminiHistory(userMsgs.slice(0, -1));
      const last = userMsgs[userMsgs.length - 1];

      const chat = model.startChat({
        history,
        generationConfig: {
          maxOutputTokens: req.maxTokens,
          temperature: req.temperature,
          stopSequences: req.stopSequences,
        },
      });

      const result = await chat.sendMessageStream(last.content);

      for await (const chunk of result.stream) {
        if (signal?.aborted) break;
        const text = chunk.text();
        if (text) {
          content += text;
          yield { type: 'delta', delta: text };
        }
      }

      const resp = await result.response;
      const usage = resp.usageMetadata;
      if (usage) {
        promptTok = usage.promptTokenCount || 0;
        compTok = usage.candidatesTokenCount || 0;
      }

      const cand = resp.candidates?.[0];
      if (cand?.finishReason) finish = this.mapFinish(cand.finishReason);

      const latency = Date.now() - t0;

      yield {
        type: 'done',
        usage: { promptTokens: promptTok, completionTokens: compTok, totalTokens: promptTok + compTok },
        model: modelId,
        finishReason: finish,
      };

      return {
        content, model: modelId,
        usage: { promptTokens: promptTok, completionTokens: compTok, totalTokens: promptTok + compTok },
        finishReason: finish, latencyMs: latency,
      };
    } catch (err) {
      const norm = this.normalizeError(err);
      yield { type: 'error', error: norm };
      throw err;
    }
  }

  async testConnection(apiKey: string): Promise<ConnectionTestResult> {
    const client = this.createClient(apiKey);
    const t0 = Date.now();

    try {
      const model = this.getModel(client, 'gemini-2.0-flash');
      await model.generateContent('Hi');
      return { success: true, latencyMs: Date.now() - t0 };
    } catch (err) {
      const norm = this.normalizeError(err);
      const latency = Date.now() - t0;

      // rate limit = key is valid, just quota exhausted
      if (norm.type === 'rate_limit') {
        console.log('google: key valid but quota exceeded');
        return { success: true, latencyMs: latency };
      }
      return { success: false, error: norm, latencyMs: latency };
    }
  }

  normalizeError(err: unknown, status?: number): NormalizedError {
    if (err instanceof Error) {
      const msg = err.message.toLowerCase();

      // rate limit first
      if (msg.includes('429') || msg.includes('quota') || msg.includes('rate limit') || 
          msg.includes('resource_exhausted') || msg.includes('too many requests') ||
          msg.includes('exceeded your current quota')) {
        const match = err.message.match(/retry in (\d+(?:\.\d+)?)/i);
        const retryMs = match ? parseFloat(match[1]) * 1000 : undefined;
        return { type: 'rate_limit', retryAfterMs: retryMs, message: err.message };
      }
      if (msg.includes('api_key') || msg.includes('invalid api key') || msg.includes('api key not valid')) {
        return { type: 'auth', message: 'Invalid Google AI API key' };
      }
      if (msg.includes('safety') || msg.includes('blocked')) {
        return { type: 'content_filter', message: err.message };
      }
      if (msg.includes('token') || msg.includes('context')) {
        return { type: 'context_length', maxTokens: 0, message: err.message };
      }
    }
    return super.normalizeError(err, status);
  }

  private toGeminiHistory(msgs: ChatMessage[]): Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> {
    return msgs.map(m => ({
      role: m.role === 'assistant' ? 'model' as const : 'user' as const,
      parts: [{ text: m.content }],
    }));
  }

  private mapFinish(r: string): GenerateResponse['finishReason'] {
    if (r === 'STOP') return 'stop';
    if (r === 'MAX_TOKENS') return 'length';
    if (r === 'SAFETY') return 'content_filter';
    return 'stop';
  }
}

export const googleAdapter = new GoogleAdapter();
