// Routes messages to LLM providers with fallback, circuit breaker, rate limiting

import { BrowserWindow } from 'electron';
import { providerRegistry, type ProviderId, type GenerateRequest, type GenerateResponse, type StreamChunk, type NormalizedError } from '../providers/index.js';
import { providerRepo, messageRepo, routerEventsRepo } from '../database/repositories/index.js';
import { getCandidatePool, selectProvider } from './candidate-pool.js';
import * as health from './health.js';
import * as circuitBreaker from './circuit-breaker.js';
import { contextWindowService } from '../services/context-window.service.js';
import { memoryService } from '../services/memory.service.js';

const MAX_ATTEMPTS = 6;
const BASE_RETRY_MS = 1000;
const MAX_RETRY_MS = 30000;

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

// anti-repeat tracking
const recentProviders = new Map<string, ProviderId[]>();

export async function routeMessage(opts: RouteOptions): Promise<RouteResult> {
  const { conversationId, messages, userMessageId, signal, onStream } = opts;
  
  console.log('router: starting', conversationId);
  
  const contextMsgs = await memoryService.buildContext(conversationId, messages);
  const stats = contextWindowService.getStats(messages, contextMsgs);
  console.log('router: context', stats);
  
  // summarize in bg if conversation is getting long
  if (messages.length > contextWindowService.getMaxMessages() + 10) {
    memoryService.maybeSummarize(conversationId).catch(e => console.error('bg summarize failed:', e));
  }
  
  const tried: ProviderId[] = [];
  const recent = recentProviders.get(conversationId) || [];
  
  let lastErr: NormalizedError | undefined;
  let attempt = 0;

  while (attempt < MAX_ATTEMPTS) {
    attempt++;

    if (signal?.aborted) {
      return { success: false, error: { type: 'unknown', message: 'cancelled' }, attemptsUsed: attempt };
    }

    const candidates = getCandidatePool({ excludeProviders: tried, recentProviders: recent });
    console.log('router: attempt', attempt, '- candidates:', candidates.length, candidates.map(c => c.id));

    if (!candidates.length) {
      routerEventsRepo.log({
        conversationId, messageId: userMessageId, eventType: 'exhaust',
        attemptNumber: attempt, errorType: lastErr?.type, errorMessage: lastErr?.message,
      });
      return { success: false, error: lastErr || { type: 'unknown', message: 'no providers left' }, attemptsUsed: attempt };
    }

    const candidate = selectProvider(candidates);
    if (!candidate) continue;

    const pid = candidate.id;
    tried.push(pid);
    console.log('router: selected', pid);

    routerEventsRepo.log({ conversationId, messageId: userMessageId, eventType: 'attempt', providerId: pid, attemptNumber: attempt });

    const adapter = providerRegistry.get(pid);
    const apiKey = providerRepo.getKey(pid);

    console.log('router:', pid, '- adapter:', !!adapter, 'key:', !!apiKey);

    if (!adapter || !apiKey) {
      console.warn('router: skip', pid, '- missing adapter/key');
      continue;
    }

    const t0 = Date.now();

    try {
      const req: GenerateRequest = { messages: contextMsgs };
      const gen = adapter.generate(req, apiKey, signal);
      
      let content = '';
      let gotDone = false;

      for await (const chunk of gen) {
        if (signal?.aborted) throw new Error('cancelled');

        if (chunk.type === 'delta' && chunk.delta) {
          content += chunk.delta;
          onStream?.(chunk);
        } else if (chunk.type === 'error') {
          throw chunk.error;
        } else if (chunk.type === 'done') {
          gotDone = true;
          onStream?.(chunk);
        }
      }

      const latency = Date.now() - t0;
      const response: GenerateResponse = {
        content,
        model: adapter.capabilities.defaultModel,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        finishReason: 'stop',
        latencyMs: latency,
      };

      if (!gotDone) {
        onStream?.({ type: 'done', usage: response.usage, model: response.model, finishReason: 'stop' });
      }

      health.recordSuccess(pid, latency);
      circuitBreaker.recordSuccess(pid);
      updateRecent(conversationId, pid);

      routerEventsRepo.log({
        conversationId, messageId: userMessageId, eventType: 'success',
        providerId: pid, attemptNumber: attempt, latencyMs: latency,
      });

      return {
        success: true, content, providerId: pid, model: response.model,
        tokens: response.usage.totalTokens, latencyMs: latency, attemptsUsed: attempt,
      };

    } catch (err) {
      const latency = Date.now() - t0;
      console.error('router:', pid, 'error:', err);
      
      const normErr = adapter.normalizeError(err);
      lastErr = normErr;
      console.error('router: normalized:', normErr);

      health.recordFailure(pid, latency, normErr.type);
      circuitBreaker.recordFailure(pid);

      if (normErr.type === 'rate_limit') {
        circuitBreaker.applyRateLimitCooldown(pid, normErr.retryAfterMs);
      }

      routerEventsRepo.log({
        conversationId, messageId: userMessageId, eventType: 'failure',
        providerId: pid, attemptNumber: attempt, latencyMs: latency,
        errorType: normErr.type, errorMessage: normErr.message,
      });

      routerEventsRepo.log({
        conversationId, messageId: userMessageId, eventType: 'fallback',
        providerId: pid, attemptNumber: attempt,
      });

      const delay = Math.min(BASE_RETRY_MS * Math.pow(2, attempt - 1), MAX_RETRY_MS);
      await sleep(delay);
    }
  }

  return { success: false, error: lastErr || { type: 'unknown', message: 'max attempts' }, attemptsUsed: attempt };
}

export async function routeAndSaveMessage(opts: RouteOptions & { window: BrowserWindow }): Promise<RouteResult> {
  const { conversationId, window } = opts;
  
  const msg = messageRepo.create({ conversationId, role: 'assistant', content: '' });

  const handleStream = (chunk: StreamChunk) => {
    window.webContents.send(`chat:stream:${conversationId}`, chunk);
  };

  const result = await routeMessage({ ...opts, onStream: handleStream });

  if (result.success && result.content) {
    messageRepo.updateMetadata(msg.id, {
      content: result.content,
      providerId: result.providerId,
      model: result.model,
      tokens: result.tokens,
      latencyMs: result.latencyMs,
    });
    return { ...result, messageId: msg.id };
  } else {
    messageRepo.delete(msg.id);
    return result;
  }
}

function updateRecent(convId: string, pid: ProviderId): void {
  const recent = recentProviders.get(convId) || [];
  recent.push(pid);
  if (recent.length > 10) recent.shift();
  recentProviders.set(convId, recent);
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

export function clearRecentProviders(convId: string): void {
  recentProviders.delete(convId);
}

export { getCandidatePool, selectProvider, hasAvailableProviders, getPoolSummary } from './candidate-pool.js';
export * as health from './health.js';
export * as circuitBreaker from './circuit-breaker.js';
