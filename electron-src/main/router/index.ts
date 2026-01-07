/**
 * Main Router Module
 * 
 * Routes messages to available LLM providers with:
 * - Intelligent provider selection based on health
 * - Automatic fallback on failures
 * - Circuit breaker for failing providers
 * - Rate limit handling with cooldowns
 * - Event logging for debugging
 */

import { BrowserWindow } from 'electron';
import { providerRegistry, type ProviderId, type GenerateRequest, type GenerateResponse, type StreamChunk, type NormalizedError } from '../providers/index.js';
import { providerRepo, messageRepo, routerEventsRepo } from '../database/repositories/index.js';
import { getCandidatePool, selectProvider } from './candidate-pool.js';
import * as health from './health.js';
import * as circuitBreaker from './circuit-breaker.js';
import { contextWindowService } from '../services/context-window.service.js';
import { memoryService } from '../services/memory.service.js';

// Router configuration
const MAX_ATTEMPTS = 6;
const BASE_RETRY_DELAY_MS = 1000;
const MAX_RETRY_DELAY_MS = 30000;

export interface RouteResult {
  success: boolean;
  messageId?: string;
  content?: string;
  providerId?: ProviderId;
  model?: string;
  tokens?: number;
  latencyMs?: number;
  error?: NormalizedError;
  attemptsUsed: number;
}

export interface RouteOptions {
  conversationId: string;
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  userMessageId?: string;
  signal?: AbortSignal;
  onStream?: (chunk: StreamChunk) => void;
}

// Track recent providers per conversation for anti-repeat
const recentProviders = new Map<string, ProviderId[]>();

/**
 * Route a message to an available provider
 */
export async function routeMessage(options: RouteOptions): Promise<RouteResult> {
  const { conversationId, messages, userMessageId, signal, onStream } = options;
  
  console.log('[router] Starting route for conversation:', conversationId);
  
  // Build context with memory (includes sliding window internally)
  const contextMessages = await memoryService.buildContext(conversationId, messages);
  const stats = contextWindowService.getStats(messages, contextMessages);
  console.log('[router] Context with memory:', stats);
  
  // Check if we should trigger background summarization (after this request)
  const shouldSummarize = messages.length > contextWindowService.getMaxMessages() + 10;
  if (shouldSummarize) {
    // Trigger summarization in background (don't await)
    memoryService.maybeSummarize(conversationId).catch(err => 
      console.error('[router] Background summarization failed:', err)
    );
  }
  
  const attemptedProviders: ProviderId[] = [];
  const recent = recentProviders.get(conversationId) || [];
  
  let lastError: NormalizedError | undefined;
  let attempt = 0;

  while (attempt < MAX_ATTEMPTS) {
    attempt++;

    // Check for abort
    if (signal?.aborted) {
      return {
        success: false,
        error: { type: 'unknown', message: 'Request cancelled' },
        attemptsUsed: attempt,
      };
    }

    // Get candidate pool excluding already attempted providers
    const candidates = getCandidatePool({
      excludeProviders: attemptedProviders,
      recentProviders: recent,
    });

    console.log('[router] Attempt', attempt, '- Candidates available:', candidates.length, candidates.map(c => c.id));

    if (candidates.length === 0) {
      // No more providers to try
      routerEventsRepo.log({
        conversationId,
        messageId: userMessageId,
        eventType: 'exhaust',
        attemptNumber: attempt,
        errorType: lastError?.type,
        errorMessage: lastError?.message,
      });

      return {
        success: false,
        error: lastError || { type: 'unknown', message: 'All providers exhausted' },
        attemptsUsed: attempt,
      };
    }

    // Select a provider
    const candidate = selectProvider(candidates);
    if (!candidate) {
      continue;
    }

    const providerId = candidate.id;
    attemptedProviders.push(providerId);

    console.log('[router] Selected provider:', providerId);

    // Log attempt
    routerEventsRepo.log({
      conversationId,
      messageId: userMessageId,
      eventType: 'attempt',
      providerId,
      attemptNumber: attempt,
    });

    // Get the adapter and API key
    const adapter = providerRegistry.get(providerId);
    const apiKey = providerRepo.getKey(providerId);

    console.log('[router] Provider', providerId, '- adapter:', !!adapter, 'hasKey:', !!apiKey);

    if (!adapter || !apiKey) {
      console.warn('[router] Skipping', providerId, '- missing adapter or key');
      continue;
    }

    const startTime = Date.now();

    try {
      // Call the provider
      const request: GenerateRequest = { messages: contextMessages };
      const generator = adapter.generate(request, apiKey, signal);
      
      let fullContent = '';
      let finalResponse: GenerateResponse | undefined;
      let receivedDone = false;

      for await (const chunk of generator) {
        if (signal?.aborted) {
          throw new Error('Request cancelled');
        }

        if (chunk.type === 'delta' && chunk.delta) {
          fullContent += chunk.delta;
          onStream?.(chunk);
        } else if (chunk.type === 'error') {
          throw chunk.error;
        } else if (chunk.type === 'done') {
          receivedDone = true;
          onStream?.(chunk);
        }
      }

      // Get the final response from the generator return value
      const latencyMs = Date.now() - startTime;
      finalResponse = {
        content: fullContent,
        model: adapter.capabilities.defaultModel,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        finishReason: 'stop',
        latencyMs,
      };

      // Always send done event if not already sent
      if (!receivedDone) {
        onStream?.({ 
          type: 'done', 
          usage: finalResponse.usage, 
          model: finalResponse.model, 
          finishReason: 'stop' 
        });
      }

      // Record success
      health.recordSuccess(providerId, finalResponse.latencyMs);
      circuitBreaker.recordSuccess(providerId);

      // Update recent providers
      updateRecentProviders(conversationId, providerId);

      // Log success
      routerEventsRepo.log({
        conversationId,
        messageId: userMessageId,
        eventType: 'success',
        providerId,
        attemptNumber: attempt,
        latencyMs: finalResponse.latencyMs,
      });

      return {
        success: true,
        content: finalResponse.content,
        providerId,
        model: finalResponse.model,
        tokens: finalResponse.usage.totalTokens,
        latencyMs: finalResponse.latencyMs,
        attemptsUsed: attempt,
      };

    } catch (error) {
      const latencyMs = Date.now() - startTime;
      
      console.error('[router] Provider', providerId, 'error:', error);
      
      // Normalize the error
      const normalizedError = adapter.normalizeError(error);
      lastError = normalizedError;
      
      console.error('[router] Normalized error:', normalizedError);

      // Record failure
      health.recordFailure(providerId, latencyMs, normalizedError.type);
      circuitBreaker.recordFailure(providerId);

      // Handle rate limit
      if (normalizedError.type === 'rate_limit') {
        circuitBreaker.applyRateLimitCooldown(providerId, normalizedError.retryAfterMs);
      }

      // Log failure
      routerEventsRepo.log({
        conversationId,
        messageId: userMessageId,
        eventType: 'failure',
        providerId,
        attemptNumber: attempt,
        latencyMs,
        errorType: normalizedError.type,
        errorMessage: normalizedError.message,
      });

      // Log fallback
      routerEventsRepo.log({
        conversationId,
        messageId: userMessageId,
        eventType: 'fallback',
        providerId,
        attemptNumber: attempt,
      });

      // Exponential backoff before retry
      const delay = Math.min(
        BASE_RETRY_DELAY_MS * Math.pow(2, attempt - 1),
        MAX_RETRY_DELAY_MS
      );
      await sleep(delay);
    }
  }

  return {
    success: false,
    error: lastError || { type: 'unknown', message: 'Max attempts reached' },
    attemptsUsed: attempt,
  };
}

/**
 * Route a message and save to database
 */
export async function routeAndSaveMessage(options: RouteOptions & { window: BrowserWindow }): Promise<RouteResult> {
  const { conversationId, window } = options;
  
  // Create placeholder assistant message
  const assistantMessage = messageRepo.create({
    conversationId,
    role: 'assistant',
    content: '',
  });

  // Stream handler that updates the UI
  const handleStream = (chunk: StreamChunk) => {
    window.webContents.send(`chat:stream:${conversationId}`, chunk);
  };

  // Route the message
  const result = await routeMessage({
    ...options,
    onStream: handleStream,
  });

  if (result.success && result.content) {
    // Update the assistant message with final content
    messageRepo.updateMetadata(assistantMessage.id, {
      content: result.content,
      providerId: result.providerId,
      model: result.model,
      tokens: result.tokens,
      latencyMs: result.latencyMs,
    });

    return {
      ...result,
      messageId: assistantMessage.id,
    };
  } else {
    // Delete the placeholder message on failure
    messageRepo.delete(assistantMessage.id);
    return result;
  }
}

/**
 * Update recent providers for anti-repeat
 */
function updateRecentProviders(conversationId: string, providerId: ProviderId): void {
  const recent = recentProviders.get(conversationId) || [];
  recent.push(providerId);
  
  // Keep only last N providers
  if (recent.length > 10) {
    recent.shift();
  }
  
  recentProviders.set(conversationId, recent);
}

/**
 * Sleep helper
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Clear recent providers for a conversation
 */
export function clearRecentProviders(conversationId: string): void {
  recentProviders.delete(conversationId);
}

// Export sub-modules for direct access
export { getCandidatePool, selectProvider, hasAvailableProviders, getPoolSummary } from './candidate-pool.js';
export * as health from './health.js';
export * as circuitBreaker from './circuit-breaker.js';

