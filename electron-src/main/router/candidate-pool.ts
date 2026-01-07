// Provider selection with health scoring, anti-repeat, circuit breaker

import { providerRepo, type Provider } from '../database/repositories/index.js';
import { getProviderHealth } from './health.js';
import { canAttempt, isInCooldown } from './circuit-breaker.js';
import type { ProviderId } from '../providers/base.js';

const ANTI_REPEAT = 3; // penalize last N providers

export interface CandidateProvider {
  id: ProviderId;
  displayName: string;
  priority: number;
  healthScore: number;
  weight: number;
}

export interface CandidatePoolOptions {
  excludeProviders?: ProviderId[];
  recentProviders?: ProviderId[];
}

export function getCandidatePool(opts: CandidatePoolOptions = {}): CandidateProvider[] {
  const { excludeProviders = [], recentProviders = [] } = opts;
  const providers = providerRepo.list();

  const candidates = providers
    .filter(p => isEligible(p, excludeProviders))
    .map(p => toCandidate(p, recentProviders))
    .filter((c): c is CandidateProvider => c !== null);

  candidates.sort((a, b) => b.weight - a.weight);
  return candidates;
}

function isEligible(p: Provider, exclude: ProviderId[]): boolean {
  const id = p.id as ProviderId;
  if (!p.isEnabled || !p.hasKey) return false;
  if (exclude.includes(id)) return false;
  if (!canAttempt(id) || isInCooldown(id)) return false;
  return true;
}

function antiRepeatMult(pid: ProviderId, recent: ProviderId[]): number {
  const window = recent.slice(-ANTI_REPEAT);
  const idx = window.indexOf(pid);
  if (idx === -1) return 1.0;
  // more recent = higher penalty
  const recency = window.length - idx;
  return [0.2, 0.5, 0.7][recency - 1] || 0.7;
}

function toCandidate(p: Provider, recent: ProviderId[] = []): CandidateProvider | null {
  const id = p.id as ProviderId;
  const health = getProviderHealth(id);
  if (!health) return null;

  // 30% health, 20% priority, 50% random for diversity
  const prio = p.priority / 100;
  const rand = 0.5 + Math.random() * 0.5;
  const base = (health.score * 0.3) + (prio * 0.2) + (rand * 0.5);
  const weight = base * antiRepeatMult(id, recent);

  return { id, displayName: p.displayName, priority: p.priority, healthScore: health.score, weight };
}

export function selectProvider(candidates: CandidateProvider[]): CandidateProvider | null {
  if (!candidates.length) return null;
  if (candidates.length === 1) {
    console.log('pool: only 1 ->', candidates[0].id);
    return candidates[0];
  }

  const total = candidates.reduce((s, c) => s + c.weight, 0);
  console.log('pool:', candidates.map(c => `${c.id}(${c.weight.toFixed(3)})`).join(' '));

  if (total === 0) {
    const pick = candidates[Math.floor(Math.random() * candidates.length)];
    console.log('pool: all zero, random ->', pick.id);
    return pick;
  }

  let r = Math.random() * total;
  for (const c of candidates) {
    r -= c.weight;
    if (r <= 0) {
      console.log('pool: selected', c.id, c.weight.toFixed(3));
      return c;
    }
  }

  console.log('pool: fallback ->', candidates[0].id);
  return candidates[0];
}

export function getNextCandidate(exclude: ProviderId[], recent: ProviderId[] = []): CandidateProvider | null {
  return selectProvider(getCandidatePool({ excludeProviders: exclude, recentProviders: recent }));
}

export function hasAvailableProviders(): boolean {
  return getCandidatePool().length > 0;
}

export function getPoolSummary() {
  const providers = providerRepo.list();
  let available = 0, cooldown = 0, noKey = 0, disabled = 0;

  for (const p of providers) {
    const id = p.id as ProviderId;
    if (!p.isEnabled) disabled++;
    else if (!p.hasKey) noKey++;
    else if (isInCooldown(id) || !canAttempt(id)) cooldown++;
    else available++;
  }

  return { total: providers.length, available, inCooldown: cooldown, noKey, disabled };
}
