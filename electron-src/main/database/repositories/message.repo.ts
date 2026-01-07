import { v4 as uuidv4 } from 'uuid';
import { query, queryOne, execute, saveDatabase } from '../sqlite.js';

export interface MessageRow {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  created_at: string;
  provider_id: string | null;
  model: string | null;
  tokens: number | null;
  latency_ms: number | null;
  error_type: string | null;
  is_regenerated: number;
  parent_message_id: string | null;
}

export interface Message {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: number;
  providerId?: string;
  model?: string;
  tokens?: number;
  latencyMs?: number;
  errorType?: string;
  isRegenerated: boolean;
  parentMessageId?: string;
}

export interface CreateMessageInput {
  conversationId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  providerId?: string;
  model?: string;
  tokens?: number;
  latencyMs?: number;
  errorType?: string;
  parentMessageId?: string;
}

function rowToMessage(row: MessageRow): Message {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role,
    content: row.content,
    createdAt: new Date(row.created_at).getTime(),
    providerId: row.provider_id ?? undefined,
    model: row.model ?? undefined,
    tokens: row.tokens ?? undefined,
    latencyMs: row.latency_ms ?? undefined,
    errorType: row.error_type ?? undefined,
    isRegenerated: row.is_regenerated === 1,
    parentMessageId: row.parent_message_id ?? undefined,
  };
}

export const messageRepo = {
  /**
   * Get all messages for a conversation
   */
  listByConversation(conversationId: string): Message[] {
    const rows = query<MessageRow>(
      'SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC',
      [conversationId]
    );
    return rows.map(rowToMessage);
  },

  /**
   * Get a single message by ID
   */
  get(id: string): Message | null {
    const row = queryOne<MessageRow>('SELECT * FROM messages WHERE id = ?', [id]);
    return row ? rowToMessage(row) : null;
  },

  /**
   * Create a new message
   */
  create(input: CreateMessageInput): Message {
    const id = uuidv4();
    const now = new Date().toISOString();

    execute(
      `INSERT INTO messages (
        id, conversation_id, role, content, created_at,
        provider_id, model, tokens, latency_ms, error_type, parent_message_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.conversationId,
        input.role,
        input.content,
        now,
        input.providerId ?? null,
        input.model ?? null,
        input.tokens ?? null,
        input.latencyMs ?? null,
        input.errorType ?? null,
        input.parentMessageId ?? null,
      ]
    );
    saveDatabase();

    return {
      id,
      conversationId: input.conversationId,
      role: input.role,
      content: input.content,
      createdAt: new Date(now).getTime(),
      providerId: input.providerId,
      model: input.model,
      tokens: input.tokens,
      latencyMs: input.latencyMs,
      errorType: input.errorType,
      isRegenerated: false,
      parentMessageId: input.parentMessageId,
    };
  },

  /**
   * Update message content (for streaming)
   */
  updateContent(id: string, content: string): boolean {
    const result = execute('UPDATE messages SET content = ? WHERE id = ?', [content, id]);
    saveDatabase();
    return result.changes > 0;
  },

  /**
   * Update message metadata after completion
   */
  updateMetadata(
    id: string,
    metadata: { content?: string; providerId?: string; model?: string; tokens?: number; latencyMs?: number }
  ): boolean {
    const fields: string[] = [];
    const values: (string | number)[] = [];

    if (metadata.content !== undefined) {
      fields.push('content = ?');
      values.push(metadata.content);
    }
    if (metadata.providerId !== undefined) {
      fields.push('provider_id = ?');
      values.push(metadata.providerId);
    }
    if (metadata.model !== undefined) {
      fields.push('model = ?');
      values.push(metadata.model);
    }
    if (metadata.tokens !== undefined) {
      fields.push('tokens = ?');
      values.push(metadata.tokens);
    }
    if (metadata.latencyMs !== undefined) {
      fields.push('latency_ms = ?');
      values.push(metadata.latencyMs);
    }

    if (fields.length === 0) return false;

    values.push(id);
    const result = execute(`UPDATE messages SET ${fields.join(', ')} WHERE id = ?`, values);
    saveDatabase();
    return result.changes > 0;
  },

  /**
   * Mark a message as regenerated
   */
  markRegenerated(id: string): boolean {
    const result = execute('UPDATE messages SET is_regenerated = 1 WHERE id = ?', [id]);
    saveDatabase();
    return result.changes > 0;
  },

  /**
   * Delete a message
   */
  delete(id: string): boolean {
    const result = execute('DELETE FROM messages WHERE id = ?', [id]);
    saveDatabase();
    return result.changes > 0;
  },

  /**
   * Get the last N messages for context
   */
  getContext(conversationId: string, limit: number = 20): Message[] {
    const rows = query<MessageRow>(
      `SELECT * FROM (
        SELECT * FROM messages 
        WHERE conversation_id = ? 
        ORDER BY created_at DESC 
        LIMIT ?
      ) ORDER BY created_at ASC`,
      [conversationId, limit]
    );
    return rows.map(rowToMessage);
  },
};
