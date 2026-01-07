/**
 * Health Scoring Module
 * 
 * Implements EWMA-based health scoring for providers.
 * Used by the router to make intelligent selection decisions.
 */

import { providerRepo, type ProviderHealth } from '../database/repositories/index.js';

// EWMA alpha for latency smoothing (0.2 = recent values weighted more)
const LATENCY_ALPHA = 0.2;

// Health score thresholds
const HEALTH_EXCELLENT = 0.9;
const HEALTH_GOOD = 0.7;
const HEALTH_DEGRADED = 0.5;
const HEALTH_POOR = 0.3;

export type HealthStatus = 'excellent' | 'good' | 'degraded' | 'poor' | 'unavailable';

export interface HealthInfo {
  providerId: string;
  score: number;
  status: HealthStatus;
  latencyMs: number;
  successRate: number;
  isAvailable: boolean;
}

/**
 * Calculate health score from provider metrics
 * 
 * Formula: successRate * (1 - latencyPenalty)
 * - successRate: ratio of successful requests
 * - latencyPenalty: capped at 50%, based on EWMA latency
 */
export function calculateHealthScore(
  successCount: number,
  failureCount: number,
  latencyEwmaMs: number
): number {
  const totalRequests = successCount + failureCount;
  
  // No requests yet = default healthy
  if (totalRequests === 0) {
    return 1.0;
  }

  // Success rate
  const successRate = successCount / totalRequests;

  // Latency penalty (0-0.5, capped)
  // Assume 5000ms is the worst acceptable latency
  const latencyPenalty = Math.min(latencyEwmaMs / 10000, 0.5);

  // Final score
  const score = successRate * (1 - latencyPenalty);

  return Math.max(0, Math.min(1, score));
}

/**
 * Update latency using EWMA
 */
export function updateLatencyEwma(currentEwma: number, newLatency: number): number {
  return LATENCY_ALPHA * newLatency + (1 - LATENCY_ALPHA) * currentEwma;
}

/**
 * Convert health score to status
 */
export function scoreToStatus(score: number): HealthStatus {
  if (score >= HEALTH_EXCELLENT) return 'excellent';
  if (score >= HEALTH_GOOD) return 'good';
  if (score >= HEALTH_DEGRADED) return 'degraded';
  if (score >= HEALTH_POOR) return 'poor';
  return 'unavailable';
}

/**
 * Get health info for a provider
 */
export function getProviderHealth(providerId: string): HealthInfo | null {
  const health = providerRepo.getHealth(providerId);
  if (!health) return null;

  const totalRequests = health.successCount + health.failureCount;
  const successRate = totalRequests > 0 ? health.successCount / totalRequests : 1;

  return {
    providerId,
    score: health.healthScore,
    status: scoreToStatus(health.healthScore),
    latencyMs: health.latencyEwmaMs,
    successRate,
    isAvailable: health.circuitState !== 'open' && !isInCooldown(health),
  };
}

/**
 * Get health info for all providers
 */
export function getAllProviderHealth(): HealthInfo[] {
  const healthRecords = providerRepo.getAllHealth();
  
  return healthRecords.map(health => {
    const totalRequests = health.successCount + health.failureCount;
    const successRate = totalRequests > 0 ? health.successCount / totalRequests : 1;

    return {
      providerId: health.providerId,
      score: health.healthScore,
      status: scoreToStatus(health.healthScore),
      latencyMs: health.latencyEwmaMs,
      successRate,
      isAvailable: health.circuitState !== 'open' && !isInCooldown(health),
    };
  });
}

/**
 * Check if a provider is in cooldown
 */
function isInCooldown(health: ProviderHealth): boolean {
  if (!health.cooldownUntil) return false;
  return Date.now() < health.cooldownUntil;
}

/**
 * Record a successful request
 */
export function recordSuccess(providerId: string, latencyMs: number): void {
  providerRepo.updateHealth(providerId, true, latencyMs);
}

/**
 * Record a failed request
 */
export function recordFailure(providerId: string, latencyMs: number, errorType?: string): void {
  providerRepo.updateHealth(providerId, false, latencyMs, errorType);
}

