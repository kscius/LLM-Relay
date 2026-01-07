/**
 * Conversation Memory Repository
 * 
 * Manages conversation summaries and key facts for intelligent context management.
 */

import { query, queryOne, execute, saveDatabase } from '../sqlite.js';

export interface ConversationMemory {
  conversationId: string;
  summary: string | null;
  keyFacts: string[];
  lastSummarizedAt: string | null;
  messageCountAtSummary: number;
  lastSummarizedMessageId: string | null;
  createdAt: string;
  updatedAt: string;
}

interface MemoryRow {
  conversation_id: string;
  summary: string | null;
  key_facts: string;
  last_summarized_at: string | null;
  message_count_at_summary: number;
  last_summarized_message_id: string | null;
  created_at: string;
  updated_at: string;
}

function rowToMemory(row: MemoryRow): ConversationMemory {
  let keyFacts: string[] = [];
  try {
    keyFacts = JSON.parse(row.key_facts || '[]');
  } catch {
    keyFacts = [];
  }

  return {
    conversationId: row.conversation_id,
    summary: row.summary,
    keyFacts,
    lastSummarizedAt: row.last_summarized_at,
    messageCountAtSummary: row.message_count_at_summary,
    lastSummarizedMessageId: row.last_summarized_message_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const conversationMemoryRepo = {
  /**
   * Get memory for a conversation
   */
  get(conversationId: string): ConversationMemory | null {
    const row = queryOne<MemoryRow>(
      'SELECT * FROM conversation_memory WHERE conversation_id = ?',
      [conversationId]
    );

    return row ? rowToMemory(row) : null;
  },

  /**
   * Create or get memory for a conversation
   */
  getOrCreate(conversationId: string): ConversationMemory {
    let memory = this.get(conversationId);
    
    if (!memory) {
      execute(
        `INSERT INTO conversation_memory (conversation_id) VALUES (?)`,
        [conversationId]
      );
      saveDatabase();
      memory = this.get(conversationId);
    }

    return memory!;
  },

  /**
   * Update the summary for a conversation
   */
  updateSummary(
    conversationId: string,
    summary: string,
    messageCount: number,
    lastMessageId: string
  ): void {
    execute(
      `INSERT INTO conversation_memory (conversation_id, summary, message_count_at_summary, last_summarized_message_id, last_summarized_at, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
       ON CONFLICT(conversation_id) DO UPDATE SET
         summary = excluded.summary,
         message_count_at_summary = excluded.message_count_at_summary,
         last_summarized_message_id = excluded.last_summarized_message_id,
         last_summarized_at = excluded.last_summarized_at,
         updated_at = excluded.updated_at`,
      [conversationId, summary, messageCount, lastMessageId]
    );
    saveDatabase();
  },

  /**
   * Add key facts to a conversation's memory
   */
  addKeyFacts(conversationId: string, facts: string[]): void {
    const memory = this.getOrCreate(conversationId);
    const allFacts = [...new Set([...memory.keyFacts, ...facts])]; // Deduplicate

    execute(
      `UPDATE conversation_memory 
       SET key_facts = ?, updated_at = datetime('now')
       WHERE conversation_id = ?`,
      [JSON.stringify(allFacts), conversationId]
    );
    saveDatabase();
  },

  /**
   * Set key facts for a conversation (replaces existing)
   */
  setKeyFacts(conversationId: string, facts: string[]): void {
    this.getOrCreate(conversationId);

    execute(
      `UPDATE conversation_memory 
       SET key_facts = ?, updated_at = datetime('now')
       WHERE conversation_id = ?`,
      [JSON.stringify(facts), conversationId]
    );
    saveDatabase();
  },

  /**
   * Remove a key fact
   */
  removeKeyFact(conversationId: string, fact: string): void {
    const memory = this.get(conversationId);
    if (!memory) return;

    const updatedFacts = memory.keyFacts.filter(f => f !== fact);

    execute(
      `UPDATE conversation_memory 
       SET key_facts = ?, updated_at = datetime('now')
       WHERE conversation_id = ?`,
      [JSON.stringify(updatedFacts), conversationId]
    );
    saveDatabase();
  },

  /**
   * Check if conversation needs re-summarization
   */
  needsSummary(conversationId: string, currentMessageCount: number, threshold: number = 10): boolean {
    const memory = this.get(conversationId);
    if (!memory) return currentMessageCount > threshold;

    // Need summary if we've added more than threshold messages since last summary
    const messagesSinceLastSummary = currentMessageCount - memory.messageCountAtSummary;
    return messagesSinceLastSummary >= threshold;
  },

  /**
   * Delete memory for a conversation
   */
  delete(conversationId: string): boolean {
    execute('DELETE FROM conversation_memory WHERE conversation_id = ?', [conversationId]);
    saveDatabase();
    return true;
  },

  /**
   * List all memories (for debugging/admin)
   */
  list(): ConversationMemory[] {
    const rows = query<MemoryRow>('SELECT * FROM conversation_memory ORDER BY updated_at DESC');
    return rows.map(rowToMemory);
  },
};

