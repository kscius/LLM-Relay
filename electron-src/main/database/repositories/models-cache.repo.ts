/**
 * Models Cache Repository
 * 
 * Manages cached model lists for providers with dynamic model discovery.
 */

import { getDatabase } from '../sqlite.js';

export interface CachedModel {
  providerId: string;
  modelId: string;
  displayName: string | null;
  contextLength: number | null;
  isAvailable: boolean;
  cachedAt: number;
  expiresAt: number;
}

// Cache TTL: 24 hours
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

class ModelsCacheRepository {
  /**
   * Get cached models for a provider
   */
  getModels(providerId: string): CachedModel[] {
    const db = getDatabase();
    const now = new Date().toISOString();
    
    const stmt = db.prepare(`
      SELECT 
        provider_id,
        model_id,
        display_name,
        context_length,
        is_available,
        cached_at,
        expires_at
      FROM models_cache
      WHERE provider_id = ? AND expires_at > ? AND is_available = 1
      ORDER BY model_id
    `);
    stmt.bind([providerId, now]);
    
    const models: CachedModel[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject();
      models.push({
        providerId: row.provider_id as string,
        modelId: row.model_id as string,
        displayName: row.display_name as string | null,
        contextLength: row.context_length as number | null,
        isAvailable: (row.is_available as number) === 1,
        cachedAt: new Date(row.cached_at as string).getTime(),
        expiresAt: new Date(row.expires_at as string).getTime(),
      });
    }
    stmt.free();
    
    return models;
  }

  /**
   * Check if cache is valid for a provider
   */
  isCacheValid(providerId: string): boolean {
    const db = getDatabase();
    const now = new Date().toISOString();
    
    const stmt = db.prepare(`
      SELECT COUNT(*) as count 
      FROM models_cache 
      WHERE provider_id = ? AND expires_at > ?
    `);
    stmt.bind([providerId, now]);
    stmt.step();
    const result = stmt.getAsObject();
    stmt.free();
    
    return (result.count as number) > 0;
  }

  /**
   * Get model IDs only (for quick selection)
   */
  getModelIds(providerId: string): string[] {
    const models = this.getModels(providerId);
    return models.map(m => m.modelId);
  }

  /**
   * Update cache for a provider (replaces all models)
   */
  updateCache(providerId: string, models: Array<{ id: string; name?: string; contextLength?: number }>): void {
    const db = getDatabase();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + CACHE_TTL_MS);
    
    // Delete old cache for this provider first
    const deleteStmt = db.prepare('DELETE FROM models_cache WHERE provider_id = ?');
    deleteStmt.bind([providerId]);
    deleteStmt.step();
    deleteStmt.free();
    
    // Deduplicate models by ID (some APIs return duplicates)
    const uniqueModels = new Map<string, { id: string; name?: string; contextLength?: number }>();
    for (const model of models) {
      if (!uniqueModels.has(model.id)) {
        uniqueModels.set(model.id, model);
      }
    }
    
    // Insert new models using INSERT OR REPLACE to handle any edge cases
    for (const model of uniqueModels.values()) {
      db.run(
        `INSERT OR REPLACE INTO models_cache (provider_id, model_id, display_name, context_length, is_available, cached_at, expires_at)
         VALUES (?, ?, ?, ?, 1, ?, ?)`,
        [
          providerId,
          model.id,
          model.name || null,
          model.contextLength || null,
          now.toISOString(),
          expiresAt.toISOString(),
        ]
      );
    }
    
    console.log(`[ModelCache] Updated ${uniqueModels.size} models for ${providerId}, expires at ${expiresAt.toISOString()}`);
  }

  /**
   * Clear cache for a provider
   */
  clearCache(providerId: string): void {
    const db = getDatabase();
    const stmt = db.prepare('DELETE FROM models_cache WHERE provider_id = ?');
    stmt.bind([providerId]);
    stmt.step();
    stmt.free();
    
    console.log(`[ModelCache] Cleared cache for ${providerId}`);
  }

  /**
   * Clear all expired cache entries
   */
  clearExpired(): number {
    const db = getDatabase();
    const now = new Date().toISOString();
    
    const stmt = db.prepare('DELETE FROM models_cache WHERE expires_at < ?');
    stmt.bind([now]);
    stmt.step();
    stmt.free();
    
    // Get count of deleted rows (sql.js doesn't have changes() easily accessible)
    return 0;
  }

  /**
   * Clear all cache
   */
  clearAll(): void {
    const db = getDatabase();
    db.run('DELETE FROM models_cache');
    console.log('[ModelCache] Cleared all cache');
  }

  /**
   * Get cache stats
   */
  getStats(): { providerId: string; modelCount: number; expiresAt: string }[] {
    const db = getDatabase();
    
    const stmt = db.prepare(`
      SELECT provider_id, COUNT(*) as count, MAX(expires_at) as expires_at
      FROM models_cache
      GROUP BY provider_id
    `);
    
    const stats: { providerId: string; modelCount: number; expiresAt: string }[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject();
      stats.push({
        providerId: row.provider_id as string,
        modelCount: row.count as number,
        expiresAt: row.expires_at as string,
      });
    }
    stmt.free();
    
    return stats;
  }
}

export const modelsCacheRepo = new ModelsCacheRepository();

