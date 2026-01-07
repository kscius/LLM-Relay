// Circuit breaker: closed -> open -> half_open

import { providerRepo } from '../database/repositories/index.js';

const FAIL_THRESHOLD = 3;
const COOLDOWN_BASE = 2 * 60 * 1000; // 2min
const COOLDOWN_MAX = 10 * 60 * 1000; // 10min
const COOLDOWN_MULT = 1.5;

export type CircuitState = 'closed' | 'open' | 'half_open';

export interface CircuitBreakerState {
  providerId: string;
  state: CircuitState;
  consecutiveFailures: number;
  cooldownUntil?: number;
  canAttempt: boolean;
}

const failures = new Map<string, number>();

export function getCircuitState(pid: string): CircuitBreakerState {
  const h = providerRepo.getHealth(pid);
  if (!h) return { providerId: pid, state: 'closed', consecutiveFailures: 0, canAttempt: false };

  const fails = failures.get(pid) || 0;
  const now = Date.now();

  // expired cooldown -> half_open
  if (h.circuitState === 'open' && h.cooldownUntil && now >= h.cooldownUntil) {
    providerRepo.updateCircuitState(pid, 'half_open');
    return { providerId: pid, state: 'half_open', consecutiveFailures: fails, cooldownUntil: h.cooldownUntil, canAttempt: true };
  }

  return {
    providerId: pid,
    state: h.circuitState,
    consecutiveFailures: fails,
    cooldownUntil: h.cooldownUntil,
    canAttempt: h.circuitState !== 'open',
  };
}

export function canAttempt(pid: string): boolean {
  return getCircuitState(pid).canAttempt;
}

export function recordSuccess(pid: string): void {
  failures.set(pid, 0);
  const h = providerRepo.getHealth(pid);
  if (h && h.circuitState !== 'closed') {
    providerRepo.updateCircuitState(pid, 'closed');
  }
}

export function recordFailure(pid: string): void {
  const f = (failures.get(pid) || 0) + 1;
  failures.set(pid, f);
  if (f >= FAIL_THRESHOLD) openCircuit(pid, f);
}

function openCircuit(pid: string, f: number): void {
  const factor = Math.pow(COOLDOWN_MULT, f - FAIL_THRESHOLD);
  const ms = Math.min(COOLDOWN_BASE * factor, COOLDOWN_MAX);
  providerRepo.updateCircuitState(pid, 'open', new Date(Date.now() + ms));
}

export function applyRateLimitCooldown(pid: string, retryMs?: number): void {
  const ms = Math.min(retryMs || COOLDOWN_BASE, COOLDOWN_MAX);
  providerRepo.setCooldown(pid, new Date(Date.now() + ms));
}

export function isInCooldown(pid: string): boolean {
  const h = providerRepo.getHealth(pid);
  return h?.cooldownUntil ? Date.now() < h.cooldownUntil : false;
}

export function getCooldownRemaining(pid: string): number {
  const h = providerRepo.getHealth(pid);
  return h?.cooldownUntil ? Math.max(0, h.cooldownUntil - Date.now()) : 0;
}

export function resetCircuit(pid: string): void {
  failures.delete(pid);
  providerRepo.updateCircuitState(pid, 'closed');
  providerRepo.clearCooldown(pid);
}

export function getAllCircuitStates(): CircuitBreakerState[] {
  return providerRepo.getAllHealth().map(h => getCircuitState(h.providerId));
}
