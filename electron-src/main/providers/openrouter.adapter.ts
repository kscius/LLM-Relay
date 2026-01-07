/**
 * OpenRouter Provider Adapter
 * 
 * API Reference: https://openrouter.ai/docs/api/reference/overview
 * 
 * Key features:
 * - OpenAI-compatible Chat Completions API
 * - Free models end with `:free` suffix
 * - Rate limits: 20 req/min, 50 req/day (free tier)
 * - Streaming supported via SSE
 */

import { BaseProviderAdapter, type GenerateRequest, type StreamChunk, type NormalizedError, type ProviderCapabilities, type ConnectionTestResult, type GenerateResponse } from './base.js';
import { providerUsageRepo } from '../database/repositories/index.js';

// Base URL for OpenRouter API
const BASE_URL = 'https://openrouter.ai/api/v1';

// Rate limit tracking (in-memory for minute-based limits)
let minuteRequestCount = 0;
let minuteResetTime = Date.now() + 60000;

export class OpenRouterAdapter extends BaseProviderAdapter {
  readonly id = 'openrouter' as const;
  readonly displayName = 'OpenRouter';
  readonly description = 'Llama 3.1, Gemma 3, Qwen3 :free models (50 req/day free)';

  readonly capabilities: ProviderCapabilities = {
    supportsStreaming: true,
    supportsSystemMessage: true,
    supportsFunctionCalling: true,
    supportsVision: true, // Some models support vision
    maxContextTokens: 131072, // Varies by model
    defaultModel: 'meta-llama/llama-3.1-8b-instruct:free',
    availableModels: [
      // Meta Llama (free)
      'meta-llama/llama-3.1-8b-instruct:free',
      'meta-llama/llama-3.2-3b-instruct:free',
      'meta-llama/llama-3.2-1b-instruct:free',
      // Google Gemma (free)
      'google/gemma-3-4b-it:free',
      'google/gemma-3-12b-it:free',
      'google/gemma-3-27b-it:free',
      'google/gemma-2-9b-it:free',
      // Qwen (free)
      'qwen/qwen3-8b:free',
      'qwen/qwen3-4b:free',
      'qwen/qwen3-1.7b:free',
      'qwen/qwen-2.5-7b-instruct:free',
      // Microsoft Phi (free)
      'microsoft/phi-3-mini-128k-instruct:free',
      'microsoft/phi-3-medium-128k-instruct:free',
      // Mistral (free)
      'mistralai/mistral-7b-instruct:free',
      // DeepSeek (free)
      'deepseek/deepseek-r1-0528:free',
      // Other notable free models
      'openchat/openchat-7b:free',
      'huggingfaceh4/zephyr-7b-beta:free',
      'nousresearch/hermes-3-llama-3.1-405b:free',
    ],
  };

  /**
   * Check rate limits before making a request
   */
  private checkRateLimits(): { allowed: boolean; error?: string; retryAfterMs?: number } {
    const now = Date.now();
    
    // Reset minute counter if needed
    if (now >= minuteResetTime) {
      minuteRequestCount = 0;
      minuteResetTime = now + 60000;
    }

    // Check minute limit (20 req/min)
    if (minuteRequestCount >= 20) {
      const waitMs = minuteResetTime - now;
      return {
        allowed: false,
        error: `Rate limit: 20 requests per minute exceeded. Wait ${Math.ceil(waitMs / 1000)}s.`,
        retryAfterMs: waitMs,
      };
    }

    // Check daily limit (50 req/day for free tier)
    const usageStatus = providerUsageRepo.getUsageStatus('openrouter');
    if (usageStatus.limits.requests > 0 && usageStatus.currentUsage.requests >= usageStatus.limits.requests) {
      return {
        allowed: false,
        error: `Daily limit reached (${usageStatus.currentUsage.requests}/${usageStatus.limits.requests} requests). Resets at midnight UTC.`,
        retryAfterMs: this.getTimeUntilReset(),
      };
    }

    return { allowed: true };
  }

  /**
   * Get milliseconds until next reset (midnight UTC)
   */
  private getTimeUntilReset(): number {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    tomorrow.setUTCHours(0, 0, 0, 0);
    return tomorrow.getTime() - now.getTime();
  }

  /**
   * Test connection by verifying the API key
   */
  async testConnection(apiKey: string): Promise<ConnectionTestResult> {
    const startTime = Date.now();

    try {
      const response = await fetch(`${BASE_URL}/auth/key`, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
        },
      });

      const latencyMs = Date.now() - startTime;

      if (!response.ok) {
        return {
          success: false,
          error: {
            type: 'auth',
            message: `Authentication failed: HTTP ${response.status}`,
          },
          latencyMs,
        };
      }

      // Just verify the response was successful
      await response.json();
      return { 
        success: true, 
        latencyMs,
      };
    } catch (error) {
      return {
        success: false,
        error: {
          type: 'network',
          message: error instanceof Error ? error.message : 'Connection failed',
        },
        latencyMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Generate a streaming response
   */
  async *generate(request: GenerateRequest, apiKey: string): AsyncGenerator<StreamChunk, GenerateResponse, undefined> {
    // Check rate limits first
    const rateLimitCheck = this.checkRateLimits();
    if (!rateLimitCheck.allowed) {
      yield {
        type: 'error',
        error: {
          type: 'rate_limit',
          message: rateLimitCheck.error!,
          retryAfterMs: rateLimitCheck.retryAfterMs,
        },
      };
      return {
        content: '',
        model: this.capabilities.defaultModel,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        finishReason: 'error',
        latencyMs: 0,
      };
    }

    // Increment minute counter
    minuteRequestCount++;

    const model = request.model || this.selectRandomModel();
    const startTime = Date.now();
    let totalContent = '';

    try {
      const response = await fetch(`${BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://llm-relay.app',
          'X-Title': 'LLM Relay',
        },
        body: JSON.stringify({
          model,
          messages: request.messages.map(m => ({
            role: m.role,
            content: m.content,
          })),
          stream: true,
          max_tokens: request.maxTokens || 2048,
          temperature: request.temperature,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({})) as { error?: { message?: string } };
        yield {
          type: 'error',
          error: this.mapError(response.status, errorData),
        };
        return {
          content: '',
          model,
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          finishReason: 'error',
          latencyMs: Date.now() - startTime,
        };
      }

      // Handle SSE streaming
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body');
      }

      const decoder = new TextDecoder();
      let buffer = '';
      let promptTokens = 0;
      let completionTokens = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();

            if (data === '[DONE]') {
              continue;
            }

            try {
              const parsed = JSON.parse(data);
              const delta = parsed.choices?.[0]?.delta?.content || '';

              if (delta) {
                totalContent += delta;
                yield {
                  type: 'delta',
                  delta,
                };
              }

              // Capture usage if available
              if (parsed.usage) {
                promptTokens = parsed.usage.prompt_tokens || 0;
                completionTokens = parsed.usage.completion_tokens || 0;
              }
            } catch {
              // Ignore parse errors
            }
          }
        }
      }

      // Record usage
      providerUsageRepo.recordUsage('openrouter', {
        requests: 1,
        tokens: promptTokens + completionTokens,
      });
      console.log(`[OpenRouter] Recorded usage: 1 request, ${promptTokens + completionTokens} tokens`);

      yield {
        type: 'done',
        usage: {
          promptTokens,
          completionTokens,
          totalTokens: promptTokens + completionTokens,
        },
        model,
        finishReason: 'stop',
      };

      return {
        content: totalContent,
        model,
        usage: {
          promptTokens,
          completionTokens,
          totalTokens: promptTokens + completionTokens,
        },
        finishReason: 'stop',
        latencyMs: Date.now() - startTime,
      };
    } catch (error) {
      console.error('[OpenRouter] Generate error:', error);
      yield {
        type: 'error',
        error: {
          type: 'network',
          message: error instanceof Error ? error.message : 'Network error',
        },
      };
      return {
        content: totalContent,
        model,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        finishReason: 'error',
        latencyMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Get current usage status
   */
  getUsageStatus(): { dailyRequests: number; dailyLimit: number; minuteRequests: number; minuteLimit: number; isLocked: boolean } {
    const status = providerUsageRepo.getUsageStatus('openrouter');
    return {
      dailyRequests: status.currentUsage.requests,
      dailyLimit: status.limits.requests,
      minuteRequests: minuteRequestCount,
      minuteLimit: 20,
      isLocked: status.isLocked || minuteRequestCount >= 20,
    };
  }

  /**
   * Map HTTP errors to normalized errors
   */
  private mapError(status: number, errorData: { error?: { message?: string } }): NormalizedError {
    const message = errorData?.error?.message || `HTTP ${status}`;

    switch (status) {
      case 401:
      case 403:
        return {
          type: 'auth',
          message: `Authentication failed: ${message}`,
        };
      case 402:
        return {
          type: 'rate_limit',
          message: `Payment required or negative balance: ${message}`,
          retryAfterMs: 0, // Can't retry without payment
        };
      case 429:
        return {
          type: 'rate_limit',
          message: `Rate limit exceeded: ${message}`,
          retryAfterMs: 60000, // Wait 1 minute
        };
      case 400:
        return {
          type: 'unknown',
          message: `Invalid request: ${message}`,
        };
      case 500:
      case 502:
      case 503:
      case 504:
        return {
          type: 'server_error',
          statusCode: status,
          message: `Server error: ${message}`,
        };
      default:
        return {
          type: 'unknown',
          message,
        };
    }
  }
}

export const openrouterAdapter = new OpenRouterAdapter();

