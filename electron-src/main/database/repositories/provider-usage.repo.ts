/**
 * Provider Usage Repository
 * 
 * Tracks daily usage for providers with free tier limits.
 * Supports checking limits and blocking when exceeded.
 */

import { query, queryOne, execute, saveDatabase } from '../sqlite.js';
import type { ProviderId } from '../../providers/base.js';

export interface ProviderUsage {
  providerId: string;
  usageDate: string;
  requestCount: number;
  tokensUsed: number;
  neuronsUsed: number;
}

export interface ProviderLimits {
  providerId: string;
  dailyRequestLimit: number;
  dailyTokenLimit: number;
  dailyNeuronLimit: number;
  enforceLimits: boolean;
  resetHourUtc: number;
}

export interface UsageStatus {
  providerId: string;
  isLocked: boolean;
  currentUsage: {
    requests: number;
    tokens: number;
    neurons: number;
  };
  limits: {
    requests: number;
    tokens: number;
    neurons: number;
  };
  percentUsed: {
    requests: number;
    tokens: number;
    neurons: number;
  };
  resetsAt: string;
}

interface UsageRow {
  provider_id: string;
  usage_date: string;
  request_count: number;
  tokens_used: number;
  neurons_used: number;
}

interface LimitsRow {
  provider_id: string;
  daily_request_limit: number;
  daily_token_limit: number;
  daily_neuron_limit: number;
  enforce_limits: number;
  reset_hour_utc: number;
}

/**
 * Get today's date in UTC (YYYY-MM-DD)
 */
function getTodayUTC(): string {
  return new Date().toISOString().split('T')[0];
}

/**
 * Get the next reset time based on reset hour
 */
function getNextResetTime(resetHourUtc: number): string {
  const now = new Date();
  const reset = new Date(now);
  reset.setUTCHours(resetHourUtc, 0, 0, 0);
  
  if (reset <= now) {
    reset.setUTCDate(reset.getUTCDate() + 1);
  }
  
  return reset.toISOString();
}

export const providerUsageRepo = {
  /**
   * Get today's usage for a provider
   */
  getTodayUsage(providerId: ProviderId): ProviderUsage | null {
    const today = getTodayUTC();
    const row = queryOne<UsageRow>(
      'SELECT * FROM provider_usage WHERE provider_id = ? AND usage_date = ?',
      [providerId, today]
    );
    
    if (!row) return null;
    
    return {
      providerId: row.provider_id,
      usageDate: row.usage_date,
      requestCount: row.request_count,
      tokensUsed: row.tokens_used,
      neuronsUsed: row.neurons_used,
    };
  },

  /**
   * Get limits for a provider
   */
  getLimits(providerId: ProviderId): ProviderLimits | null {
    const row = queryOne<LimitsRow>(
      'SELECT * FROM provider_limits WHERE provider_id = ?',
      [providerId]
    );
    
    if (!row) return null;
    
    return {
      providerId: row.provider_id,
      dailyRequestLimit: row.daily_request_limit,
      dailyTokenLimit: row.daily_token_limit,
      dailyNeuronLimit: row.daily_neuron_limit,
      enforceLimits: row.enforce_limits === 1,
      resetHourUtc: row.reset_hour_utc,
    };
  },

  /**
   * Set limits for a provider
   */
  setLimits(providerId: ProviderId, limits: Partial<Omit<ProviderLimits, 'providerId'>>): void {
    const existing = this.getLimits(providerId);
    
    if (existing) {
      const setClauses: string[] = ['updated_at = datetime(\'now\')'];
      const params: (string | number)[] = [];
      
      if (limits.dailyRequestLimit !== undefined) {
        setClauses.push('daily_request_limit = ?');
        params.push(limits.dailyRequestLimit);
      }
      if (limits.dailyTokenLimit !== undefined) {
        setClauses.push('daily_token_limit = ?');
        params.push(limits.dailyTokenLimit);
      }
      if (limits.dailyNeuronLimit !== undefined) {
        setClauses.push('daily_neuron_limit = ?');
        params.push(limits.dailyNeuronLimit);
      }
      if (limits.enforceLimits !== undefined) {
        setClauses.push('enforce_limits = ?');
        params.push(limits.enforceLimits ? 1 : 0);
      }
      if (limits.resetHourUtc !== undefined) {
        setClauses.push('reset_hour_utc = ?');
        params.push(limits.resetHourUtc);
      }
      
      params.push(providerId);
      execute(
        `UPDATE provider_limits SET ${setClauses.join(', ')} WHERE provider_id = ?`,
        params
      );
    } else {
      execute(
        `INSERT INTO provider_limits (provider_id, daily_request_limit, daily_token_limit, daily_neuron_limit, enforce_limits, reset_hour_utc)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          providerId,
          limits.dailyRequestLimit || 0,
          limits.dailyTokenLimit || 0,
          limits.dailyNeuronLimit || 0,
          limits.enforceLimits !== false ? 1 : 0,
          limits.resetHourUtc || 0,
        ]
      );
    }
    saveDatabase();
  },

  /**
   * Record usage for a provider
   */
  recordUsage(providerId: ProviderId, usage: { requests?: number; tokens?: number; neurons?: number }): void {
    const today = getTodayUTC();
    const existing = this.getTodayUsage(providerId);
    
    if (existing) {
      execute(
        `UPDATE provider_usage 
         SET request_count = request_count + ?,
             tokens_used = tokens_used + ?,
             neurons_used = neurons_used + ?,
             updated_at = datetime('now')
         WHERE provider_id = ? AND usage_date = ?`,
        [
          usage.requests || 0,
          usage.tokens || 0,
          usage.neurons || 0,
          providerId,
          today,
        ]
      );
    } else {
      execute(
        `INSERT INTO provider_usage (provider_id, usage_date, request_count, tokens_used, neurons_used)
         VALUES (?, ?, ?, ?, ?)`,
        [
          providerId,
          today,
          usage.requests || 0,
          usage.tokens || 0,
          usage.neurons || 0,
        ]
      );
    }
    saveDatabase();
  },

  /**
   * Check if a provider is locked due to limit exceeded
   */
  isLocked(providerId: ProviderId): boolean {
    const limits = this.getLimits(providerId);
    if (!limits || !limits.enforceLimits) return false;
    
    const usage = this.getTodayUsage(providerId);
    if (!usage) return false;
    
    // Check each limit type
    if (limits.dailyRequestLimit > 0 && usage.requestCount >= limits.dailyRequestLimit) {
      return true;
    }
    if (limits.dailyTokenLimit > 0 && usage.tokensUsed >= limits.dailyTokenLimit) {
      return true;
    }
    if (limits.dailyNeuronLimit > 0 && usage.neuronsUsed >= limits.dailyNeuronLimit) {
      return true;
    }
    
    return false;
  },

  /**
   * Get detailed usage status for a provider
   */
  getUsageStatus(providerId: ProviderId): UsageStatus {
    const limits = this.getLimits(providerId);
    const usage = this.getTodayUsage(providerId);
    
    const currentUsage = {
      requests: usage?.requestCount || 0,
      tokens: usage?.tokensUsed || 0,
      neurons: usage?.neuronsUsed || 0,
    };
    
    const limitsValues = {
      requests: limits?.dailyRequestLimit || 0,
      tokens: limits?.dailyTokenLimit || 0,
      neurons: limits?.dailyNeuronLimit || 0,
    };
    
    const percentUsed = {
      requests: limitsValues.requests > 0 ? Math.round((currentUsage.requests / limitsValues.requests) * 100) : 0,
      tokens: limitsValues.tokens > 0 ? Math.round((currentUsage.tokens / limitsValues.tokens) * 100) : 0,
      neurons: limitsValues.neurons > 0 ? Math.round((currentUsage.neurons / limitsValues.neurons) * 100) : 0,
    };
    
    return {
      providerId,
      isLocked: this.isLocked(providerId),
      currentUsage,
      limits: limitsValues,
      percentUsed,
      resetsAt: getNextResetTime(limits?.resetHourUtc || 0),
    };
  },

  /**
   * Get usage status for all providers with limits
   */
  getAllUsageStatus(): UsageStatus[] {
    const rows = query<LimitsRow>('SELECT * FROM provider_limits');
    return rows.map(row => this.getUsageStatus(row.provider_id as ProviderId));
  },

  /**
   * Clean up old usage records (keep last 30 days)
   */
  cleanupOldRecords(): number {
    const cutoffDate = new Date();
    cutoffDate.setUTCDate(cutoffDate.getUTCDate() - 30);
    const cutoff = cutoffDate.toISOString().split('T')[0];
    
    execute('DELETE FROM provider_usage WHERE usage_date < ?', [cutoff]);
    saveDatabase();
    return 0; // sql.js doesn't return changes count easily
  },

  /**
   * Reset usage for a provider (manual reset)
   */
  resetUsage(providerId: ProviderId): void {
    const today = getTodayUTC();
    execute(
      'DELETE FROM provider_usage WHERE provider_id = ? AND usage_date = ?',
      [providerId, today]
    );
    saveDatabase();
  },
};

