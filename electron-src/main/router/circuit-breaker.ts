/**
 * Circuit Breaker Module
 * 
 * Implements the circuit breaker pattern for providers:
 * - CLOSED: Normal operation, requests flow through
 * - OPEN: Provider is failing, block all requests
 * - HALF_OPEN: Testing if provider has recovered
 */

import { providerRepo } from '../database/repositories/index.js';

// Circuit breaker configuration
const FAILURE_THRESHOLD = 3; // Consecutive failures to open
const COOLDOWN_BASE_MS = 2 * 60 * 1000; // 2 minutes base cooldown
const COOLDOWN_MAX_MS = 10 * 60 * 1000; // 10 minutes max cooldown
const COOLDOWN_MULTIPLIER = 1.5; // Exponential backoff multiplier

export type CircuitState = 'closed' | 'open' | 'half_open';

export interface CircuitBreakerState {
  providerId: string;
  state: CircuitState;
  consecutiveFailures: number;
  cooldownUntil?: number;
  canAttempt: boolean;
}

// In-memory tracking of consecutive failures (not persisted)
const consecutiveFailures = new Map<string, number>();

/**
 * Get the current state of a provider's circuit breaker
 */
export function getCircuitState(providerId: string): CircuitBreakerState {
  const health = providerRepo.getHealth(providerId);
  if (!health) {
    return {
      providerId,
      state: 'closed',
      consecutiveFailures: 0,
      canAttempt: false, // No health record means provider doesn't exist
    };
  }

  const failures = consecutiveFailures.get(providerId) || 0;
  const now = Date.now();

  // Check if cooldown has expired
  if (health.circuitState === 'open' && health.cooldownUntil) {
    if (now >= health.cooldownUntil) {
      // Transition to half-open
      providerRepo.updateCircuitState(providerId, 'half_open');
      return {
        providerId,
        state: 'half_open',
        consecutiveFailures: failures,
        cooldownUntil: health.cooldownUntil,
        canAttempt: true,
      };
    }
  }

  return {
    providerId,
    state: health.circuitState,
    consecutiveFailures: failures,
    cooldownUntil: health.cooldownUntil,
    canAttempt: health.circuitState !== 'open',
  };
}

/**
 * Check if a provider's circuit allows requests
 */
export function canAttempt(providerId: string): boolean {
  return getCircuitState(providerId).canAttempt;
}

/**
 * Record a successful request (resets circuit to closed)
 */
export function recordSuccess(providerId: string): void {
  consecutiveFailures.set(providerId, 0);
  
  const health = providerRepo.getHealth(providerId);
  if (health && health.circuitState !== 'closed') {
    providerRepo.updateCircuitState(providerId, 'closed');
  }
}

/**
 * Record a failed request
 */
export function recordFailure(providerId: string): void {
  const failures = (consecutiveFailures.get(providerId) || 0) + 1;
  consecutiveFailures.set(providerId, failures);

  // Check if we should open the circuit
  if (failures >= FAILURE_THRESHOLD) {
    openCircuit(providerId, failures);
  }
}

/**
 * Open the circuit breaker for a provider
 */
function openCircuit(providerId: string, failures: number): void {
  // Calculate cooldown with exponential backoff
  const backoffFactor = Math.pow(COOLDOWN_MULTIPLIER, failures - FAILURE_THRESHOLD);
  const cooldownMs = Math.min(COOLDOWN_BASE_MS * backoffFactor, COOLDOWN_MAX_MS);
  const cooldownUntil = new Date(Date.now() + cooldownMs);

  providerRepo.updateCircuitState(providerId, 'open', cooldownUntil);
}

/**
 * Apply a rate limit cooldown (from 429 response)
 */
export function applyRateLimitCooldown(providerId: string, retryAfterMs?: number): void {
  const cooldownMs = retryAfterMs || COOLDOWN_BASE_MS;
  const cappedCooldownMs = Math.min(cooldownMs, COOLDOWN_MAX_MS);
  const cooldownUntil = new Date(Date.now() + cappedCooldownMs);

  providerRepo.setCooldown(providerId, cooldownUntil);
}

/**
 * Check if a provider is in cooldown
 */
export function isInCooldown(providerId: string): boolean {
  const health = providerRepo.getHealth(providerId);
  if (!health || !health.cooldownUntil) return false;
  return Date.now() < health.cooldownUntil;
}

/**
 * Get remaining cooldown time in milliseconds
 */
export function getCooldownRemaining(providerId: string): number {
  const health = providerRepo.getHealth(providerId);
  if (!health || !health.cooldownUntil) return 0;
  return Math.max(0, health.cooldownUntil - Date.now());
}

/**
 * Reset circuit breaker state (for testing or manual recovery)
 */
export function resetCircuit(providerId: string): void {
  consecutiveFailures.delete(providerId);
  providerRepo.updateCircuitState(providerId, 'closed');
  providerRepo.clearCooldown(providerId);
}

/**
 * Get all circuit states for monitoring
 */
export function getAllCircuitStates(): CircuitBreakerState[] {
  const healthRecords = providerRepo.getAllHealth();
  return healthRecords.map(health => getCircuitState(health.providerId));
}

