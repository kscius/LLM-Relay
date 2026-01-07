/**
 * Cloudflare Workers AI Provider Adapter
 * 
 * API Reference: https://developers.cloudflare.com/workers-ai/
 * 
 * Key differences:
 * - Requires account_id in addition to API token
 * - API key format: "account_id:api_token" (we'll parse this)
 * - URL pattern: https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/run/{model}
 * - Free tier: 10,000 Neurons per day
 * - Supports streaming with SSE
 */

import { BaseProviderAdapter, type GenerateRequest, type StreamChunk, type NormalizedError, type ProviderCapabilities, type ConnectionTestResult, type GenerateResponse } from './base.js';
import { providerUsageRepo } from '../database/repositories/index.js';

// Neuron cost estimation per model (approximate)
// Based on Cloudflare's pricing: https://developers.cloudflare.com/workers-ai/platform/pricing/
const NEURON_COSTS: Record<string, { input: number; output: number }> = {
  // Large models cost more neurons
  '@cf/openai/gpt-oss-120b': { input: 0.5, output: 2.0 },
  '@cf/openai/gpt-oss-20b': { input: 0.1, output: 0.5 },
  '@cf/meta/llama-4-scout-17b-16e-instruct': { input: 0.2, output: 0.8 },
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast': { input: 0.3, output: 1.2 },
  '@cf/meta/llama-3.1-70b-instruct': { input: 0.3, output: 1.2 },
  '@cf/meta/llama-3.1-8b-instruct-fast': { input: 0.02, output: 0.08 },
  '@cf/meta/llama-3.1-8b-instruct': { input: 0.02, output: 0.08 },
  '@cf/meta/llama-3-8b-instruct': { input: 0.02, output: 0.08 },
  // Default for smaller models
  'default': { input: 0.01, output: 0.05 },
};

export class CloudflareAdapter extends BaseProviderAdapter {
  readonly id = 'cloudflare' as const;
  readonly displayName = 'Cloudflare Workers AI';
  readonly description = 'GPT-OSS, Llama 4/3.3/3.1, Granite, Mistral - Edge inference (10k Neurons/day free)';

  readonly capabilities: ProviderCapabilities = {
    supportsStreaming: true,
    supportsSystemMessage: true,
    supportsFunctionCalling: true, // Llama 4 Scout, Llama 3.3 70B support function calling
    supportsVision: true, // Llama 4 Scout is multimodal
    maxContextTokens: 131072, // Llama 3.1 supports 128k context
    defaultModel: '@cf/meta/llama-3.1-8b-instruct-fast',
    availableModels: [
      // Featured / Pinned models
      '@cf/openai/gpt-oss-120b',
      '@cf/openai/gpt-oss-20b',
      '@cf/meta/llama-4-scout-17b-16e-instruct',
      '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
      '@cf/meta/llama-3.1-8b-instruct-fast',
      // Llama 3.x family
      '@cf/meta/llama-3.1-70b-instruct',
      '@cf/meta/llama-3.1-8b-instruct',
      '@cf/meta/llama-3-8b-instruct',
      '@cf/meta/llama-3.2-3b-instruct',
      '@cf/meta/llama-3.2-1b-instruct',
      // Llama 2 family
      '@cf/meta/llama-2-7b-chat-fp16',
      '@cf/meta/llama-2-7b-chat-int8',
      // IBM Granite
      '@cf/ibm/granite-4.0-h-micro',
      // Mistral family
      '@cf/mistral/mistral-7b-instruct-v0.2',
      '@cf/mistral/mistral-7b-instruct-v0.1',
      '@hf/mistral/mistral-7b-instruct-v0.2',
      // Qwen family
      '@cf/qwen/qwen1.5-14b-chat-awq',
      '@cf/qwen/qwen1.5-7b-chat-awq',
      '@cf/qwen/qwen1.5-1.8b-chat',
      '@cf/qwen/qwen1.5-0.5b-chat',
      '@cf/qwen/qwen2.5-coder-32b-instruct',
      // Google Gemma
      '@cf/google/gemma-7b-it',
      '@cf/google/gemma-2b-it-lora',
      // DeepSeek
      '@cf/deepseek-ai/deepseek-math-7b-instruct',
      '@hf/thebloke/deepseek-coder-6.7b-instruct-awq',
      // Phi (Microsoft)
      '@cf/microsoft/phi-2',
      // TinyLlama
      '@cf/tinyllama/tinyllama-1.1b-chat-v1.0',
      // Others
      '@hf/nexusflow/starling-lm-7b-beta',
      '@hf/thebloke/neural-chat-7b-v3-1-awq',
      '@hf/thebloke/openhermes-2.5-mistral-7b-awq',
      '@hf/thebloke/llamaguard-7b-awq',
    ],
  };

  /**
   * Parse the API key which should be in format "account_id:api_token"
   */
  private parseCredentials(apiKey: string): { accountId: string; token: string } | null {
    const parts = apiKey.split(':');
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      console.error('[Cloudflare] Invalid API key format. Expected "account_id:api_token"');
      return null;
    }
    return { accountId: parts[0], token: parts[1] };
  }

  /**
   * Test connection by verifying the token
   */
  async testConnection(apiKey: string): Promise<ConnectionTestResult> {
    const startTime = Date.now();
    const credentials = this.parseCredentials(apiKey);
    
    if (!credentials) {
      return { 
        success: false, 
        error: { 
          type: 'auth', 
          message: 'Invalid API key format. Use "account_id:api_token"' 
        } 
      };
    }

    try {
      // Test with a simple request to verify token
      const response = await fetch(
        'https://api.cloudflare.com/client/v4/user/tokens/verify',
        {
          headers: {
            'Authorization': `Bearer ${credentials.token}`,
          },
        }
      );

      const latencyMs = Date.now() - startTime;

      if (!response.ok) {
        const data = await response.json().catch(() => ({})) as { errors?: Array<{ message: string }> };
        return { 
          success: false, 
          error: {
            type: 'auth',
            message: data.errors?.[0]?.message || `HTTP ${response.status}`
          },
          latencyMs,
        };
      }

      const data = await response.json() as { success?: boolean };
      if (!data.success) {
        return { 
          success: false, 
          error: { type: 'auth', message: 'Token verification failed' },
          latencyMs,
        };
      }

      return { success: true, latencyMs };
    } catch (error) {
      return { 
        success: false, 
        error: {
          type: 'network',
          message: error instanceof Error ? error.message : 'Connection failed'
        },
        latencyMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Estimate neurons for a request
   */
  private estimateNeurons(model: string, inputTokens: number, outputTokens: number): number {
    const costs = NEURON_COSTS[model] || NEURON_COSTS['default'];
    return Math.ceil(inputTokens * costs.input + outputTokens * costs.output);
  }

  /**
   * Estimate input tokens from messages
   */
  private estimateInputTokens(messages: Array<{ content: string }>): number {
    const totalChars = messages.reduce((sum, m) => sum + m.content.length, 0);
    return Math.ceil(totalChars / 4); // Rough estimate: 4 chars per token
  }

  /**
   * Check if we're within the free tier limit
   */
  private checkFreeTierLimit(): { allowed: boolean; currentUsage: number; limit: number; remaining: number } {
    const status = providerUsageRepo.getUsageStatus('cloudflare');
    const limit = status.limits.neurons;
    const current = status.currentUsage.neurons;
    const remaining = Math.max(0, limit - current);
    
    return {
      allowed: !status.isLocked,
      currentUsage: current,
      limit,
      remaining,
    };
  }

  /**
   * Generate a streaming response
   */
  async *generate(request: GenerateRequest, apiKey: string): AsyncGenerator<StreamChunk, GenerateResponse, undefined> {
    // Check free tier limit first
    const freeTierStatus = this.checkFreeTierLimit();
    if (!freeTierStatus.allowed) {
      console.warn(`[Cloudflare] Free tier limit reached: ${freeTierStatus.currentUsage}/${freeTierStatus.limit} Neurons`);
      yield {
        type: 'error',
        error: {
          type: 'rate_limit',
          message: `Daily free tier limit reached (${freeTierStatus.currentUsage.toLocaleString()}/${freeTierStatus.limit.toLocaleString()} Neurons). Resets at midnight UTC.`,
          retryAfterMs: this.getTimeUntilReset(),
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

    const credentials = this.parseCredentials(apiKey);
    if (!credentials) {
      yield {
        type: 'error',
        error: {
          type: 'auth',
          message: 'Invalid API key format. Use "account_id:api_token"',
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

    const model = request.model || this.selectRandomModel();
    const startTime = Date.now();
    let totalContent = '';
    const estimatedInputTokens = this.estimateInputTokens(request.messages);

    try {
      // Build the API URL
      const url = `https://api.cloudflare.com/client/v4/accounts/${credentials.accountId}/ai/run/${model}`;

      // Prepare messages
      const messages = request.messages.map(m => ({
        role: m.role,
        content: m.content,
      }));

      // Make request with streaming
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${credentials.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages,
          stream: true,
          max_tokens: request.maxTokens || 2048,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({})) as { errors?: Array<{ message?: string }> };
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

      // Check if streaming
      const contentType = response.headers.get('content-type') || '';
      
      if (contentType.includes('text/event-stream')) {
        // Handle SSE streaming
        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error('No response body');
        }

        const decoder = new TextDecoder();
        let buffer = '';

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
                const delta = parsed.response || '';
                
                if (delta) {
                  totalContent += delta;
                  yield {
                    type: 'delta',
                    delta,
                  };
                }
              } catch {
                // Ignore parse errors for incomplete chunks
              }
            }
          }
        }

        // Final done chunk
        yield {
          type: 'done',
          usage: {
            promptTokens: 0,
            completionTokens: Math.ceil(totalContent.length / 4),
            totalTokens: Math.ceil(totalContent.length / 4),
          },
          model,
          finishReason: 'stop',
        };
      } else {
        // Non-streaming response
        const data = await response.json() as { 
          result?: { response?: string };
          success?: boolean;
          errors?: Array<{ message: string }>;
        };

        if (!data.success || !data.result?.response) {
          yield {
            type: 'error',
            error: {
              type: 'unknown',
              message: data.errors?.[0]?.message || 'Unknown error',
            },
          };
          return {
            content: '',
            model,
            usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
            finishReason: 'error',
            latencyMs: Date.now() - startTime,
          };
        }

        totalContent = data.result.response;
        
        yield {
          type: 'delta',
          delta: totalContent,
        };

        yield {
          type: 'done',
          usage: {
            promptTokens: 0,
            completionTokens: Math.ceil(totalContent.length / 4),
            totalTokens: Math.ceil(totalContent.length / 4),
          },
          model,
          finishReason: 'stop',
        };
      }

      // Record usage after successful generation
      const outputTokens = Math.ceil(totalContent.length / 4);
      const neuronsUsed = this.estimateNeurons(model, estimatedInputTokens, outputTokens);
      providerUsageRepo.recordUsage('cloudflare', { 
        requests: 1, 
        tokens: estimatedInputTokens + outputTokens,
        neurons: neuronsUsed 
      });
      console.log(`[Cloudflare] Recorded usage: ~${neuronsUsed} Neurons (${estimatedInputTokens} in, ${outputTokens} out)`);

      return {
        content: totalContent,
        model,
        usage: {
          promptTokens: estimatedInputTokens,
          completionTokens: outputTokens,
          totalTokens: estimatedInputTokens + outputTokens,
        },
        finishReason: 'stop',
        latencyMs: Date.now() - startTime,
      };
    } catch (error) {
      console.error('[Cloudflare] Generate error:', error);
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
   * Get current usage status (for UI)
   */
  getUsageStatus(): { currentNeurons: number; limit: number; percentUsed: number; isLocked: boolean; resetsAt: string } {
    const status = providerUsageRepo.getUsageStatus('cloudflare');
    return {
      currentNeurons: status.currentUsage.neurons,
      limit: status.limits.neurons,
      percentUsed: status.percentUsed.neurons,
      isLocked: status.isLocked,
      resetsAt: status.resetsAt,
    };
  }

  /**
   * Map HTTP errors to normalized errors
   */
  private mapError(status: number, errorData: { errors?: Array<{ message?: string }> }): NormalizedError {
    const message = errorData?.errors?.[0]?.message || `HTTP ${status}`;

    switch (status) {
      case 401:
      case 403:
        return {
          type: 'auth',
          message: `Authentication failed: ${message}`,
        };
      case 429:
        return {
          type: 'rate_limit',
          message: `Rate limit exceeded: ${message}`,
          retryAfterMs: 60000, // 1 minute
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

export const cloudflareAdapter = new CloudflareAdapter();
