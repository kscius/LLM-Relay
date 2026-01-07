/**
 * Global Facts Repository
 * 
 * Manages persistent facts about the user that apply across conversations.
 * Supports categorization, scoping, and confidence tracking.
 */

import { query, queryOne, execute, saveDatabase } from '../sqlite.js';
import { v4 as uuidv4 } from 'uuid';

export type FactCategory = 'preference' | 'personal' | 'project' | 'technical' | 'temporary';
export type FactScope = 'global' | 'conversation';

export interface GlobalFact {
  id: string;
  fact: string;
  category: FactCategory;
  scope: FactScope;
  conversationId: string | null;
  confidence: number;
  sourceMessageId: string | null;
  sourceConversationId: string | null;
  expiresAt: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateFactInput {
  fact: string;
  category?: FactCategory;
  scope?: FactScope;
  conversationId?: string;
  confidence?: number;
  sourceMessageId?: string;
  sourceConversationId?: string;
  expiresAt?: string;
}

interface FactRow {
  id: string;
  fact: string;
  category: string;
  scope: string;
  conversation_id: string | null;
  confidence: number;
  source_message_id: string | null;
  source_conversation_id: string | null;
  expires_at: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
}

function rowToFact(row: FactRow): GlobalFact {
  return {
    id: row.id,
    fact: row.fact,
    category: row.category as FactCategory,
    scope: row.scope as FactScope,
    conversationId: row.conversation_id,
    confidence: row.confidence,
    sourceMessageId: row.source_message_id,
    sourceConversationId: row.source_conversation_id,
    expiresAt: row.expires_at,
    isActive: row.is_active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const globalFactsRepo = {
  /**
   * Create a new fact
   */
  create(input: CreateFactInput): GlobalFact {
    const id = uuidv4();
    const {
      fact,
      category = 'preference',
      scope = 'global',
      conversationId = null,
      confidence = 0.8,
      sourceMessageId = null,
      sourceConversationId = null,
      expiresAt = null,
    } = input;

    execute(
      `INSERT INTO global_facts (
        id, fact, category, scope, conversation_id, confidence,
        source_message_id, source_conversation_id, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, fact, category, scope, conversationId, confidence, sourceMessageId, sourceConversationId, expiresAt]
    );
    saveDatabase();

    return this.get(id)!;
  },

  /**
   * Get a fact by ID
   */
  get(id: string): GlobalFact | null {
    const row = queryOne<FactRow>('SELECT * FROM global_facts WHERE id = ?', [id]);
    return row ? rowToFact(row) : null;
  },

  /**
   * List all active global facts
   */
  listGlobal(): GlobalFact[] {
    const now = new Date().toISOString();
    const rows = query<FactRow>(
      `SELECT * FROM global_facts 
       WHERE scope = 'global' 
       AND is_active = 1 
       AND (expires_at IS NULL OR expires_at > ?)
       ORDER BY category, created_at DESC`,
      [now]
    );
    return rows.map(rowToFact);
  },

  /**
   * List facts for a specific conversation (includes global facts)
   */
  listForConversation(conversationId: string): GlobalFact[] {
    const now = new Date().toISOString();
    const rows = query<FactRow>(
      `SELECT * FROM global_facts 
       WHERE is_active = 1 
       AND (expires_at IS NULL OR expires_at > ?)
       AND (scope = 'global' OR conversation_id = ?)
       ORDER BY scope DESC, category, created_at DESC`,
      [now, conversationId]
    );
    return rows.map(rowToFact);
  },

  /**
   * List facts by category
   */
  listByCategory(category: FactCategory): GlobalFact[] {
    const now = new Date().toISOString();
    const rows = query<FactRow>(
      `SELECT * FROM global_facts 
       WHERE category = ? 
       AND is_active = 1 
       AND (expires_at IS NULL OR expires_at > ?)
       ORDER BY created_at DESC`,
      [category, now]
    );
    return rows.map(rowToFact);
  },

  /**
   * List all facts (including inactive, for admin)
   */
  listAll(): GlobalFact[] {
    const rows = query<FactRow>('SELECT * FROM global_facts ORDER BY is_active DESC, category, created_at DESC');
    return rows.map(rowToFact);
  },

  /**
   * Update a fact
   */
  update(id: string, updates: Partial<Pick<GlobalFact, 'fact' | 'category' | 'confidence' | 'expiresAt' | 'isActive'>>): boolean {
    const setClauses: string[] = ['updated_at = datetime(\'now\')'];
    const params: (string | number | null)[] = [];

    if (updates.fact !== undefined) {
      setClauses.push('fact = ?');
      params.push(updates.fact);
    }
    if (updates.category !== undefined) {
      setClauses.push('category = ?');
      params.push(updates.category);
    }
    if (updates.confidence !== undefined) {
      setClauses.push('confidence = ?');
      params.push(updates.confidence);
    }
    if (updates.expiresAt !== undefined) {
      setClauses.push('expires_at = ?');
      params.push(updates.expiresAt);
    }
    if (updates.isActive !== undefined) {
      setClauses.push('is_active = ?');
      params.push(updates.isActive ? 1 : 0);
    }

    params.push(id);

    execute(
      `UPDATE global_facts SET ${setClauses.join(', ')} WHERE id = ?`,
      params
    );
    saveDatabase();

    return true;
  },

  /**
   * Soft delete (deactivate) a fact
   */
  deactivate(id: string): boolean {
    return this.update(id, { isActive: false });
  },

  /**
   * Hard delete a fact
   */
  delete(id: string): boolean {
    execute('DELETE FROM global_facts WHERE id = ?', [id]);
    saveDatabase();
    return true;
  },

  /**
   * Find similar facts (for deduplication)
   */
  findSimilar(factText: string, threshold: number = 0.8): GlobalFact[] {
    // Simple substring matching for now
    // Could be improved with embeddings/vector search
    const normalizedInput = factText.toLowerCase().trim();
    const allFacts = this.listGlobal();
    
    return allFacts.filter(f => {
      const normalizedFact = f.fact.toLowerCase().trim();
      // Check if one contains the other or they're very similar
      return normalizedFact.includes(normalizedInput) || 
             normalizedInput.includes(normalizedFact) ||
             this.calculateSimilarity(normalizedFact, normalizedInput) >= threshold;
    });
  },

  /**
   * Simple string similarity (Jaccard-like)
   */
  calculateSimilarity(a: string, b: string): number {
    const wordsA = new Set(a.split(/\s+/));
    const wordsB = new Set(b.split(/\s+/));
    
    const intersection = new Set([...wordsA].filter(x => wordsB.has(x)));
    const union = new Set([...wordsA, ...wordsB]);
    
    return intersection.size / union.size;
  },

  /**
   * Add or update a fact (upsert-like behavior)
   * If similar fact exists, update confidence. Otherwise create new.
   */
  addOrUpdate(input: CreateFactInput): GlobalFact {
    const similar = this.findSimilar(input.fact, 0.85);
    
    if (similar.length > 0) {
      // Update confidence of existing fact
      const existing = similar[0];
      const newConfidence = Math.min(1.0, existing.confidence + 0.1);
      this.update(existing.id, { confidence: newConfidence });
      return this.get(existing.id)!;
    }
    
    return this.create(input);
  },

  /**
   * Clean up expired temporary facts
   */
  cleanupExpired(): number {
    const now = new Date().toISOString();
    execute(
      `DELETE FROM global_facts WHERE expires_at IS NOT NULL AND expires_at < ?`,
      [now]
    );
    saveDatabase();
    // Return count would require a separate query
    return 0;
  },

  /**
   * Get fact statistics
   */
  getStats(): { total: number; byCategory: Record<FactCategory, number>; global: number; conversation: number } {
    const all = this.listAll().filter(f => f.isActive);
    
    const byCategory: Record<FactCategory, number> = {
      preference: 0,
      personal: 0,
      project: 0,
      technical: 0,
      temporary: 0,
    };
    
    let global = 0;
    let conversation = 0;
    
    for (const fact of all) {
      byCategory[fact.category]++;
      if (fact.scope === 'global') global++;
      else conversation++;
    }
    
    return {
      total: all.length,
      byCategory,
      global,
      conversation,
    };
  },
};

