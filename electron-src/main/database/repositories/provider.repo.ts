import { safeStorage } from 'electron';
import { query, queryOne, execute, saveDatabase } from '../sqlite.js';

/**
 * Encrypt a string using Electron's safeStorage
 * Falls back to base64 if encryption is not available (dev mode)
 */
function encryptKey(plaintext: string): string {
  if (safeStorage.isEncryptionAvailable()) {
    const encrypted = safeStorage.encryptString(plaintext);
    return encrypted.toString('base64');
  }
  // Fallback: base64 encoding (not secure, for dev only)
  console.warn('[provider.repo] safeStorage not available, using base64 fallback');
  return 'b64:' + Buffer.from(plaintext).toString('base64');
}

/**
 * Decrypt a string using Electron's safeStorage
 * Falls back to base64 if encryption was not used
 */
function decryptKey(encrypted: string): string {
  if (encrypted.startsWith('b64:')) {
    // Base64 fallback format
    return Buffer.from(encrypted.slice(4), 'base64').toString('utf-8');
  }
  
  if (safeStorage.isEncryptionAvailable()) {
    try {
      const buffer = Buffer.from(encrypted, 'base64');
      return safeStorage.decryptString(buffer);
    } catch (error) {
      // May be old base64-only key, try fallback
      console.warn('[provider.repo] Failed to decrypt with safeStorage, trying base64 fallback');
      return Buffer.from(encrypted, 'base64').toString('utf-8');
    }
  }
  
  // Fallback: try base64 decoding
  return Buffer.from(encrypted, 'base64').toString('utf-8');
}

export interface ProviderRow {
  id: string;
  display_name: string;
  description: string | null;
  is_enabled: number;
  priority: number;
  created_at: string;
  updated_at: string;
}

export interface ProviderHealthRow {
  provider_id: string;
  health_score: number;
  latency_ewma_ms: number;
  success_count: number;
  failure_count: number;
  last_success_at: string | null;
  last_failure_at: string | null;
  last_error_type: string | null;
  circuit_state: 'closed' | 'open' | 'half_open';
  circuit_opened_at: string | null;
  cooldown_until: string | null;
  updated_at: string;
}

export interface Provider {
  id: string;
  displayName: string;
  description: string;
  isEnabled: boolean;
  priority: number;
  hasKey: boolean;
  keyHint?: string;
}

export interface ProviderHealth {
  providerId: string;
  healthScore: number;
  latencyEwmaMs: number;
  successCount: number;
  failureCount: number;
  lastSuccessAt?: number;
  lastFailureAt?: number;
  lastErrorType?: string;
  circuitState: 'closed' | 'open' | 'half_open';
  circuitOpenedAt?: number;
  cooldownUntil?: number;
}

export const providerRepo = {
  /**
   * List all providers with their key status
   */
  list(): Provider[] {
    console.log('[providerRepo.list] Querying providers...');
    const rows = query<ProviderRow & { has_key: number; key_hint: string | null }>(
      `SELECT 
        p.*,
        pk.key_hint,
        CASE WHEN pk.api_key_encrypted IS NOT NULL THEN 1 ELSE 0 END as has_key
      FROM providers p
      LEFT JOIN provider_keys pk ON p.id = pk.provider_id
      ORDER BY p.priority DESC, p.display_name ASC`
    );
    console.log('[providerRepo.list] Raw rows:', rows);

    return rows.map(row => ({
      id: row.id,
      displayName: row.display_name,
      description: row.description ?? '',
      isEnabled: row.is_enabled === 1,
      priority: row.priority,
      hasKey: row.has_key === 1,
      keyHint: row.key_hint ?? undefined,
    }));
  },

  /**
   * Get a single provider
   */
  get(id: string): Provider | null {
    const row = queryOne<ProviderRow & { has_key: number; key_hint: string | null }>(
      `SELECT 
        p.*,
        pk.key_hint,
        CASE WHEN pk.api_key_encrypted IS NOT NULL THEN 1 ELSE 0 END as has_key
      FROM providers p
      LEFT JOIN provider_keys pk ON p.id = pk.provider_id
      WHERE p.id = ?`,
      [id]
    );

    if (!row) return null;

    return {
      id: row.id,
      displayName: row.display_name,
      description: row.description ?? '',
      isEnabled: row.is_enabled === 1,
      priority: row.priority,
      hasKey: row.has_key === 1,
      keyHint: row.key_hint ?? undefined,
    };
  },

  /**
   * Update provider settings
   */
  update(id: string, updates: { isEnabled?: boolean; priority?: number }): boolean {
    const fields: string[] = ["updated_at = datetime('now')"];
    const values: (string | number)[] = [];

    if (updates.isEnabled !== undefined) {
      fields.push('is_enabled = ?');
      values.push(updates.isEnabled ? 1 : 0);
    }

    if (updates.priority !== undefined) {
      fields.push('priority = ?');
      values.push(updates.priority);
    }

    values.push(id);
    const result = execute(`UPDATE providers SET ${fields.join(', ')} WHERE id = ?`, values);
    saveDatabase();
    return result.changes > 0;
  },

  /**
   * Save an API key for a provider
   * Uses Electron's safeStorage for secure encryption
   */
  saveKey(providerId: string, apiKey: string): boolean {
    const encrypted = encryptKey(apiKey);
    const hint = apiKey.slice(-4);

    const existing = queryOne<{ provider_id: string }>(
      'SELECT provider_id FROM provider_keys WHERE provider_id = ?',
      [providerId]
    );

    if (existing) {
      execute(
        "UPDATE provider_keys SET api_key_encrypted = ?, key_hint = ?, updated_at = datetime('now') WHERE provider_id = ?",
        [encrypted, hint, providerId]
      );
    } else {
      execute(
        'INSERT INTO provider_keys (provider_id, api_key_encrypted, key_hint) VALUES (?, ?, ?)',
        [providerId, encrypted, hint]
      );
    }
    saveDatabase();

    console.log(`[provider.repo] Saved encrypted key for ${providerId} (encryption: ${safeStorage.isEncryptionAvailable()})`);
    return true;
  },

  /**
   * Get a decrypted API key
   * Uses Electron's safeStorage for secure decryption
   */
  getKey(providerId: string): string | null {
    const row = queryOne<{ api_key_encrypted: string }>(
      'SELECT api_key_encrypted FROM provider_keys WHERE provider_id = ?',
      [providerId]
    );

    if (!row) return null;

    return decryptKey(row.api_key_encrypted);
  },

  /**
   * Remove an API key
   */
  removeKey(providerId: string): boolean {
    const result = execute('DELETE FROM provider_keys WHERE provider_id = ?', [providerId]);
    saveDatabase();
    return result.changes > 0;
  },

  /**
   * Get health status for a provider
   */
  getHealth(providerId: string): ProviderHealth | null {
    const row = queryOne<ProviderHealthRow>(
      'SELECT * FROM provider_health WHERE provider_id = ?',
      [providerId]
    );

    if (!row) return null;

    return {
      providerId: row.provider_id,
      healthScore: row.health_score,
      latencyEwmaMs: row.latency_ewma_ms,
      successCount: row.success_count,
      failureCount: row.failure_count,
      lastSuccessAt: row.last_success_at ? new Date(row.last_success_at).getTime() : undefined,
      lastFailureAt: row.last_failure_at ? new Date(row.last_failure_at).getTime() : undefined,
      lastErrorType: row.last_error_type ?? undefined,
      circuitState: row.circuit_state,
      circuitOpenedAt: row.circuit_opened_at ? new Date(row.circuit_opened_at).getTime() : undefined,
      cooldownUntil: row.cooldown_until ? new Date(row.cooldown_until).getTime() : undefined,
    };
  },

  /**
   * Get health for all providers
   */
  getAllHealth(): ProviderHealth[] {
    const rows = query<ProviderHealthRow>('SELECT * FROM provider_health');

    return rows.map(row => ({
      providerId: row.provider_id,
      healthScore: row.health_score,
      latencyEwmaMs: row.latency_ewma_ms,
      successCount: row.success_count,
      failureCount: row.failure_count,
      lastSuccessAt: row.last_success_at ? new Date(row.last_success_at).getTime() : undefined,
      lastFailureAt: row.last_failure_at ? new Date(row.last_failure_at).getTime() : undefined,
      lastErrorType: row.last_error_type ?? undefined,
      circuitState: row.circuit_state,
      circuitOpenedAt: row.circuit_opened_at ? new Date(row.circuit_opened_at).getTime() : undefined,
      cooldownUntil: row.cooldown_until ? new Date(row.cooldown_until).getTime() : undefined,
    }));
  },

  /**
   * Update health metrics after a request
   */
  updateHealth(
    providerId: string,
    success: boolean,
    latencyMs: number,
    errorType?: string
  ): void {
    const current = this.getHealth(providerId);
    if (!current) return;

    // Calculate EWMA for latency (alpha = 0.2)
    const alpha = 0.2;
    const newLatencyEwma = alpha * latencyMs + (1 - alpha) * current.latencyEwmaMs;

    // Update counters
    const successCount = success ? current.successCount + 1 : current.successCount;
    const failureCount = success ? current.failureCount : current.failureCount + 1;

    // Calculate health score based on success rate and latency
    const totalRequests = successCount + failureCount;
    const successRate = totalRequests > 0 ? successCount / totalRequests : 1;
    const latencyPenalty = Math.min(newLatencyEwma / 5000, 0.5); // Cap at 50% penalty
    const healthScore = Math.max(0, successRate * (1 - latencyPenalty));

    // Update timestamps
    const now = new Date().toISOString();

    if (success) {
      execute(
        `UPDATE provider_health SET
          health_score = ?,
          latency_ewma_ms = ?,
          success_count = ?,
          last_success_at = ?,
          updated_at = ?
        WHERE provider_id = ?`,
        [healthScore, newLatencyEwma, successCount, now, now, providerId]
      );
    } else {
      execute(
        `UPDATE provider_health SET
          health_score = ?,
          latency_ewma_ms = ?,
          failure_count = ?,
          last_failure_at = ?,
          last_error_type = ?,
          updated_at = ?
        WHERE provider_id = ?`,
        [healthScore, newLatencyEwma, failureCount, now, errorType ?? null, now, providerId]
      );
    }
    saveDatabase();
  },

  /**
   * Update circuit breaker state
   */
  updateCircuitState(
    providerId: string,
    state: 'closed' | 'open' | 'half_open',
    cooldownUntil?: Date
  ): void {
    const now = new Date().toISOString();

    if (state === 'open') {
      execute(
        `UPDATE provider_health SET
          circuit_state = ?,
          circuit_opened_at = ?,
          cooldown_until = ?,
          updated_at = ?
        WHERE provider_id = ?`,
        [state, now, cooldownUntil?.toISOString() ?? null, now, providerId]
      );
    } else {
      execute(
        `UPDATE provider_health SET
          circuit_state = ?,
          circuit_opened_at = NULL,
          cooldown_until = NULL,
          updated_at = ?
        WHERE provider_id = ?`,
        [state, now, providerId]
      );
    }
    saveDatabase();
  },

  /**
   * Set cooldown for a provider (e.g., after 429)
   */
  setCooldown(providerId: string, cooldownUntil: Date): void {
    execute(
      "UPDATE provider_health SET cooldown_until = ?, updated_at = datetime('now') WHERE provider_id = ?",
      [cooldownUntil.toISOString(), providerId]
    );
    saveDatabase();
  },

  /**
   * Clear cooldown for a provider
   */
  clearCooldown(providerId: string): void {
    execute(
      "UPDATE provider_health SET cooldown_until = NULL, updated_at = datetime('now') WHERE provider_id = ?",
      [providerId]
    );
    saveDatabase();
  },
};
