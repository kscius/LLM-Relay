/**
 * Candidate Pool Module
 * 
 * Selects and prioritizes providers for routing based on:
 * - Provider enabled status
 * - Valid API key
 * - Circuit breaker state
 * - Cooldown status
 * - Health score
 * - Anti-repeat window
 */

import { providerRepo, type Provider } from '../database/repositories/index.js';
import { getProviderHealth } from './health.js';
import { canAttempt, isInCooldown } from './circuit-breaker.js';
import type { ProviderId } from '../providers/base.js';

// Anti-repeat window size (number of recent providers to penalize)
const ANTI_REPEAT_WINDOW = 3;

export interface CandidateProvider {
  id: ProviderId;
  displayName: string;
  priority: number;
  healthScore: number;
  weight: number; // Calculated weight for selection
}

export interface CandidatePoolOptions {
  excludeProviders?: ProviderId[];
  recentProviders?: ProviderId[];
}

/**
 * Get the pool of candidate providers for routing
 */
export function getCandidatePool(options: CandidatePoolOptions = {}): CandidateProvider[] {
  const { excludeProviders = [], recentProviders = [] } = options;

  // Get all providers
  const providers = providerRepo.list();

  // Filter to eligible candidates
  const candidates = providers
    .filter(provider => isEligible(provider, excludeProviders))
    .map(provider => toCandidate(provider, recentProviders))
    .filter((c): c is CandidateProvider => c !== null);

  // Sort by weight (descending)
  candidates.sort((a, b) => b.weight - a.weight);

  return candidates;
}

/**
 * Check if a provider is eligible for routing
 */
function isEligible(
  provider: Provider,
  excludeProviders: ProviderId[]
): boolean {
  const id = provider.id as ProviderId;

  // Must be enabled
  if (!provider.isEnabled) return false;

  // Must have a valid API key
  if (!provider.hasKey) return false;

  // Check explicit exclusions
  if (excludeProviders.includes(id)) return false;

  // Check circuit breaker
  if (!canAttempt(id)) return false;

  // Check cooldown
  if (isInCooldown(id)) return false;

  return true;
}

/**
 * Get the anti-repeat penalty for a provider
 * Returns 0.0-1.0 where 1.0 means no penalty, 0.0 means max penalty
 */
function getAntiRepeatMultiplier(providerId: ProviderId, recentProviders: ProviderId[]): number {
  const recentWindow = recentProviders.slice(-ANTI_REPEAT_WINDOW);
  const index = recentWindow.indexOf(providerId);
  
  if (index === -1) return 1.0; // No penalty
  
  // More recent = higher penalty
  // If used 1 request ago: 0.2 multiplier
  // If used 2 requests ago: 0.5 multiplier
  // If used 3 requests ago: 0.7 multiplier
  const recency = recentWindow.length - index;
  const penalties = [0.2, 0.5, 0.7];
  return penalties[recency - 1] || 0.7;
}

/**
 * Convert a provider to a candidate with calculated weight
 */
function toCandidate(provider: Provider, recentProviders: ProviderId[] = []): CandidateProvider | null {
  const id = provider.id as ProviderId;
  const health = getProviderHealth(id);

  if (!health) return null;

  // Calculate weight based on priority and health
  const priorityWeight = provider.priority / 100; // Normalize to 0-1
  const healthWeight = health.score;
  
  // Base weight: 30% health, 20% priority, 50% random for diversity
  const randomFactor = 0.5 + Math.random() * 0.5; // 0.5 - 1.0
  const baseWeight = (healthWeight * 0.3) + (priorityWeight * 0.2) + (randomFactor * 0.5);
  
  // Apply anti-repeat penalty
  const antiRepeatMultiplier = getAntiRepeatMultiplier(id, recentProviders);
  const weight = baseWeight * antiRepeatMultiplier;

  return {
    id,
    displayName: provider.displayName,
    priority: provider.priority,
    healthScore: health.score,
    weight,
  };
}

/**
 * Select a provider using weighted random selection
 */
export function selectProvider(candidates: CandidateProvider[]): CandidateProvider | null {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) {
    console.log('[candidate-pool] Only 1 candidate:', candidates[0].id);
    return candidates[0];
  }

  // Calculate total weight
  const totalWeight = candidates.reduce((sum, c) => sum + c.weight, 0);

  // Log candidate weights for debugging
  console.log('[candidate-pool] Candidates:', candidates.map(c => 
    `${c.id}(w:${c.weight.toFixed(3)})`
  ).join(', '));

  if (totalWeight === 0) {
    // All weights are zero, pick randomly
    const selected = candidates[Math.floor(Math.random() * candidates.length)];
    console.log('[candidate-pool] All weights zero, random pick:', selected.id);
    return selected;
  }

  // Weighted random selection
  let random = Math.random() * totalWeight;
  
  for (const candidate of candidates) {
    random -= candidate.weight;
    if (random <= 0) {
      console.log('[candidate-pool] Selected:', candidate.id, 'weight:', candidate.weight.toFixed(3));
      return candidate;
    }
  }

  // Fallback to first candidate
  console.log('[candidate-pool] Fallback to first:', candidates[0].id);
  return candidates[0];
}

/**
 * Get the next best candidate after excluding some providers
 */
export function getNextCandidate(
  excludeProviders: ProviderId[],
  recentProviders: ProviderId[] = []
): CandidateProvider | null {
  const candidates = getCandidatePool({ excludeProviders, recentProviders });
  return selectProvider(candidates);
}

/**
 * Check if any providers are available
 */
export function hasAvailableProviders(): boolean {
  const candidates = getCandidatePool();
  return candidates.length > 0;
}

/**
 * Get a summary of the candidate pool for debugging
 */
export function getPoolSummary(): {
  total: number;
  available: number;
  inCooldown: number;
  noKey: number;
  disabled: number;
} {
  const providers = providerRepo.list();
  
  let available = 0;
  let inCooldownCount = 0;
  let noKey = 0;
  let disabled = 0;

  for (const provider of providers) {
    if (!provider.isEnabled) {
      disabled++;
    } else if (!provider.hasKey) {
      noKey++;
    } else if (isInCooldown(provider.id as ProviderId)) {
      inCooldownCount++;
    } else if (!canAttempt(provider.id as ProviderId)) {
      inCooldownCount++; // Circuit open
    } else {
      available++;
    }
  }

  return {
    total: providers.length,
    available,
    inCooldown: inCooldownCount,
    noKey,
    disabled,
  };
}

