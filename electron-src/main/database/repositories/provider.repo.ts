// Provider management - keys, health, circuit breaker

import { safeStorage } from 'electron';
import { query, queryOne, execute, saveDatabase } from '../sqlite.js';

function encryptKey(plain: string): string {
  if (safeStorage.isEncryptionAvailable()) {
    return safeStorage.encryptString(plain).toString('base64');
  }
  console.warn('provider: safeStorage unavailable, using b64 fallback');
  return 'b64:' + Buffer.from(plain).toString('base64');
}

function decryptKey(enc: string): string {
  if (enc.startsWith('b64:')) {
    return Buffer.from(enc.slice(4), 'base64').toString('utf-8');
  }
  if (safeStorage.isEncryptionAvailable()) {
    try {
      return safeStorage.decryptString(Buffer.from(enc, 'base64'));
    } catch {
      console.warn('provider: decrypt failed, trying b64');
      return Buffer.from(enc, 'base64').toString('utf-8');
    }
  }
  return Buffer.from(enc, 'base64').toString('utf-8');
}

export interface ProviderRow {
  id: string; display_name: string; description: string | null;
  is_enabled: number; priority: number; created_at: string; updated_at: string;
}

export interface ProviderHealthRow {
  provider_id: string; health_score: number; latency_ewma_ms: number;
  success_count: number; failure_count: number;
  last_success_at: string | null; last_failure_at: string | null; last_error_type: string | null;
  circuit_state: 'closed' | 'open' | 'half_open';
  circuit_opened_at: string | null; cooldown_until: string | null; updated_at: string;
}

export interface Provider {
  id: string; displayName: string; description: string;
  isEnabled: boolean; priority: number; hasKey: boolean; keyHint?: string;
}

export interface ProviderHealth {
  providerId: string; healthScore: number; latencyEwmaMs: number;
  successCount: number; failureCount: number;
  lastSuccessAt?: number; lastFailureAt?: number; lastErrorType?: string;
  circuitState: 'closed' | 'open' | 'half_open';
  circuitOpenedAt?: number; cooldownUntil?: number;
}

export const providerRepo = {
  list(): Provider[] {
    console.log('provider: list');
    const rows = query<ProviderRow & { has_key: number; key_hint: string | null }>(
      `SELECT p.*, pk.key_hint, CASE WHEN pk.api_key_encrypted IS NOT NULL THEN 1 ELSE 0 END as has_key
       FROM providers p LEFT JOIN provider_keys pk ON p.id = pk.provider_id
       ORDER BY p.priority DESC, p.display_name ASC`
    );
    console.log('provider: found', rows.length);
    return rows.map(r => ({
      id: r.id, displayName: r.display_name, description: r.description ?? '',
      isEnabled: r.is_enabled === 1, priority: r.priority,
      hasKey: r.has_key === 1, keyHint: r.key_hint ?? undefined,
    }));
  },

  get(id: string): Provider | null {
    const r = queryOne<ProviderRow & { has_key: number; key_hint: string | null }>(
      `SELECT p.*, pk.key_hint, CASE WHEN pk.api_key_encrypted IS NOT NULL THEN 1 ELSE 0 END as has_key
       FROM providers p LEFT JOIN provider_keys pk ON p.id = pk.provider_id WHERE p.id = ?`, [id]
    );
    if (!r) return null;
    return {
      id: r.id, displayName: r.display_name, description: r.description ?? '',
      isEnabled: r.is_enabled === 1, priority: r.priority,
      hasKey: r.has_key === 1, keyHint: r.key_hint ?? undefined,
    };
  },

  update(id: string, updates: { isEnabled?: boolean; priority?: number }): boolean {
    const f: string[] = ["updated_at = datetime('now')"];
    const v: (string | number)[] = [];
    if (updates.isEnabled !== undefined) { f.push('is_enabled = ?'); v.push(updates.isEnabled ? 1 : 0); }
    if (updates.priority !== undefined) { f.push('priority = ?'); v.push(updates.priority); }
    v.push(id);
    const r = execute(`UPDATE providers SET ${f.join(', ')} WHERE id = ?`, v);
    saveDatabase();
    return r.changes > 0;
  },

  saveKey(pid: string, key: string): boolean {
    const enc = encryptKey(key);
    const hint = key.slice(-4);
    const exists = queryOne<{ provider_id: string }>('SELECT provider_id FROM provider_keys WHERE provider_id = ?', [pid]);
    if (exists) {
      execute("UPDATE provider_keys SET api_key_encrypted = ?, key_hint = ?, updated_at = datetime('now') WHERE provider_id = ?", [enc, hint, pid]);
    } else {
      execute('INSERT INTO provider_keys (provider_id, api_key_encrypted, key_hint) VALUES (?, ?, ?)', [pid, enc, hint]);
    }
    saveDatabase();
    console.log(`provider: saved key for ${pid} (safe: ${safeStorage.isEncryptionAvailable()})`);
    return true;
  },

  getKey(pid: string): string | null {
    const r = queryOne<{ api_key_encrypted: string }>('SELECT api_key_encrypted FROM provider_keys WHERE provider_id = ?', [pid]);
    return r ? decryptKey(r.api_key_encrypted) : null;
  },

  removeKey(pid: string): boolean {
    const r = execute('DELETE FROM provider_keys WHERE provider_id = ?', [pid]);
    saveDatabase();
    return r.changes > 0;
  },

  getHealth(pid: string): ProviderHealth | null {
    const r = queryOne<ProviderHealthRow>('SELECT * FROM provider_health WHERE provider_id = ?', [pid]);
    if (!r) return null;
    return {
      providerId: r.provider_id, healthScore: r.health_score, latencyEwmaMs: r.latency_ewma_ms,
      successCount: r.success_count, failureCount: r.failure_count,
      lastSuccessAt: r.last_success_at ? new Date(r.last_success_at).getTime() : undefined,
      lastFailureAt: r.last_failure_at ? new Date(r.last_failure_at).getTime() : undefined,
      lastErrorType: r.last_error_type ?? undefined, circuitState: r.circuit_state,
      circuitOpenedAt: r.circuit_opened_at ? new Date(r.circuit_opened_at).getTime() : undefined,
      cooldownUntil: r.cooldown_until ? new Date(r.cooldown_until).getTime() : undefined,
    };
  },

  getAllHealth(): ProviderHealth[] {
    return query<ProviderHealthRow>('SELECT * FROM provider_health').map(r => ({
      providerId: r.provider_id, healthScore: r.health_score, latencyEwmaMs: r.latency_ewma_ms,
      successCount: r.success_count, failureCount: r.failure_count,
      lastSuccessAt: r.last_success_at ? new Date(r.last_success_at).getTime() : undefined,
      lastFailureAt: r.last_failure_at ? new Date(r.last_failure_at).getTime() : undefined,
      lastErrorType: r.last_error_type ?? undefined, circuitState: r.circuit_state,
      circuitOpenedAt: r.circuit_opened_at ? new Date(r.circuit_opened_at).getTime() : undefined,
      cooldownUntil: r.cooldown_until ? new Date(r.cooldown_until).getTime() : undefined,
    }));
  },

  updateHealth(pid: string, success: boolean, latencyMs: number, errType?: string): void {
    const cur = this.getHealth(pid);
    if (!cur) return;

    const alpha = 0.2;
    const ewma = alpha * latencyMs + (1 - alpha) * cur.latencyEwmaMs;
    const successCnt = success ? cur.successCount + 1 : cur.successCount;
    const failCnt = success ? cur.failureCount : cur.failureCount + 1;
    const total = successCnt + failCnt;
    const rate = total > 0 ? successCnt / total : 1;
    const penalty = Math.min(ewma / 5000, 0.5);
    const score = Math.max(0, rate * (1 - penalty));
    const now = new Date().toISOString();

    if (success) {
      execute('UPDATE provider_health SET health_score = ?, latency_ewma_ms = ?, success_count = ?, last_success_at = ?, updated_at = ? WHERE provider_id = ?',
        [score, ewma, successCnt, now, now, pid]);
    } else {
      execute('UPDATE provider_health SET health_score = ?, latency_ewma_ms = ?, failure_count = ?, last_failure_at = ?, last_error_type = ?, updated_at = ? WHERE provider_id = ?',
        [score, ewma, failCnt, now, errType ?? null, now, pid]);
    }
    saveDatabase();
  },

  updateCircuitState(pid: string, state: 'closed' | 'open' | 'half_open', cooldown?: Date): void {
    const now = new Date().toISOString();
    if (state === 'open') {
      execute('UPDATE provider_health SET circuit_state = ?, circuit_opened_at = ?, cooldown_until = ?, updated_at = ? WHERE provider_id = ?',
        [state, now, cooldown?.toISOString() ?? null, now, pid]);
    } else {
      execute('UPDATE provider_health SET circuit_state = ?, circuit_opened_at = NULL, cooldown_until = NULL, updated_at = ? WHERE provider_id = ?',
        [state, now, pid]);
    }
    saveDatabase();
  },

  setCooldown(pid: string, until: Date): void {
    execute("UPDATE provider_health SET cooldown_until = ?, updated_at = datetime('now') WHERE provider_id = ?", [until.toISOString(), pid]);
    saveDatabase();
  },

  clearCooldown(pid: string): void {
    execute("UPDATE provider_health SET cooldown_until = NULL, updated_at = datetime('now') WHERE provider_id = ?", [pid]);
    saveDatabase();
  },
};
