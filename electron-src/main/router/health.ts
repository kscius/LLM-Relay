// EWMA health scoring for providers

import { providerRepo, type ProviderHealth } from '../database/repositories/index.js';

const LATENCY_ALPHA = 0.2;

export type HealthStatus = 'excellent' | 'good' | 'degraded' | 'poor' | 'unavailable';

export interface HealthInfo {
  providerId: string;
  score: number;
  status: HealthStatus;
  latencyMs: number;
  successRate: number;
  isAvailable: boolean;
}

export function calculateHealthScore(success: number, fail: number, latencyMs: number): number {
  const total = success + fail;
  if (total === 0) return 1.0;

  const rate = success / total;
  const penalty = Math.min(latencyMs / 10000, 0.5); // max 50% penalty
  return Math.max(0, Math.min(1, rate * (1 - penalty)));
}

export function updateLatencyEwma(current: number, newVal: number): number {
  return LATENCY_ALPHA * newVal + (1 - LATENCY_ALPHA) * current;
}

export function scoreToStatus(s: number): HealthStatus {
  if (s >= 0.9) return 'excellent';
  if (s >= 0.7) return 'good';
  if (s >= 0.5) return 'degraded';
  if (s >= 0.3) return 'poor';
  return 'unavailable';
}

export function getProviderHealth(pid: string): HealthInfo | null {
  const h = providerRepo.getHealth(pid);
  if (!h) return null;

  const total = h.successCount + h.failureCount;
  const rate = total > 0 ? h.successCount / total : 1;

  return {
    providerId: pid,
    score: h.healthScore,
    status: scoreToStatus(h.healthScore),
    latencyMs: h.latencyEwmaMs,
    successRate: rate,
    isAvailable: h.circuitState !== 'open' && !inCooldown(h),
  };
}

export function getAllProviderHealth(): HealthInfo[] {
  return providerRepo.getAllHealth().map(h => {
    const total = h.successCount + h.failureCount;
    const rate = total > 0 ? h.successCount / total : 1;
    return {
      providerId: h.providerId,
      score: h.healthScore,
      status: scoreToStatus(h.healthScore),
      latencyMs: h.latencyEwmaMs,
      successRate: rate,
      isAvailable: h.circuitState !== 'open' && !inCooldown(h),
    };
  });
}

function inCooldown(h: ProviderHealth): boolean {
  return h.cooldownUntil ? Date.now() < h.cooldownUntil : false;
}

export function recordSuccess(pid: string, latency: number): void {
  providerRepo.updateHealth(pid, true, latency);
}

export function recordFailure(pid: string, latency: number, errType?: string): void {
  providerRepo.updateHealth(pid, false, latency, errType);
}
