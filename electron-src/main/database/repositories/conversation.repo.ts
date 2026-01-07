import { v4 as uuidv4 } from 'uuid';
import { query, queryOne, execute, saveDatabase } from '../sqlite.js';

export interface ConversationRow {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  message_count: number;
  total_tokens: number;
  is_archived: number;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  totalTokens: number;
  isArchived: boolean;
}

function rowToConversation(row: ConversationRow): Conversation {
  return {
    id: row.id,
    title: row.title,
    createdAt: new Date(row.created_at).getTime(),
    updatedAt: new Date(row.updated_at).getTime(),
    messageCount: row.message_count,
    totalTokens: row.total_tokens,
    isArchived: row.is_archived === 1,
  };
}

export const conversationRepo = {
  /**
   * List all conversations, ordered by updated_at descending
   */
  list(options?: { includeArchived?: boolean; limit?: number }): Conversation[] {
    const includeArchived = options?.includeArchived ?? false;
    const limit = options?.limit ?? 100;

    const sql = includeArchived
      ? 'SELECT * FROM conversations ORDER BY updated_at DESC LIMIT ?'
      : 'SELECT * FROM conversations WHERE is_archived = 0 ORDER BY updated_at DESC LIMIT ?';

    const rows = query<ConversationRow>(sql, [limit]);
    return rows.map(rowToConversation);
  },

  /**
   * Get a single conversation by ID
   */
  get(id: string): Conversation | null {
    const row = queryOne<ConversationRow>('SELECT * FROM conversations WHERE id = ?', [id]);
    return row ? rowToConversation(row) : null;
  },

  /**
   * Create a new conversation
   */
  create(title?: string): Conversation {
    const id = uuidv4();
    const now = new Date().toISOString();

    execute(
      'INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)',
      [id, title ?? 'New Chat', now, now]
    );
    saveDatabase();

    return {
      id,
      title: title ?? 'New Chat',
      createdAt: new Date(now).getTime(),
      updatedAt: new Date(now).getTime(),
      messageCount: 0,
      totalTokens: 0,
      isArchived: false,
    };
  },

  /**
   * Update a conversation
   */
  update(id: string, updates: Partial<Pick<Conversation, 'title' | 'isArchived'>>): Conversation | null {
    const existing = this.get(id);
    if (!existing) return null;

    const fields: string[] = ["updated_at = datetime('now')"];
    const values: (string | number)[] = [];

    if (updates.title !== undefined) {
      fields.push('title = ?');
      values.push(updates.title);
    }

    if (updates.isArchived !== undefined) {
      fields.push('is_archived = ?');
      values.push(updates.isArchived ? 1 : 0);
    }

    values.push(id);

    execute(`UPDATE conversations SET ${fields.join(', ')} WHERE id = ?`, values);
    saveDatabase();

    return this.get(id);
  },

  /**
   * Delete a conversation and all its messages
   */
  delete(id: string): boolean {
    const result = execute('DELETE FROM conversations WHERE id = ?', [id]);
    saveDatabase();
    return result.changes > 0;
  },

  /**
   * Generate a title from the first message content
   */
  generateTitle(content: string): string {
    // Take first 50 chars or first sentence
    const firstSentence = content.split(/[.!?\n]/)[0];
    const title = firstSentence.slice(0, 50).trim();
    return title + (content.length > 50 ? '...' : '');
  },
};
