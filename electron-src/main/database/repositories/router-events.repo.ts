import { query, execute, saveDatabase } from '../sqlite.js';

export type RouterEventType = 'attempt' | 'success' | 'failure' | 'fallback' | 'exhaust';

export interface RouterEventRow {
  id: number;
  conversation_id: string | null;
  message_id: string | null;
  event_type: RouterEventType;
  provider_id: string | null;
  attempt_number: number | null;
  latency_ms: number | null;
  error_type: string | null;
  error_message: string | null;
  created_at: string;
}

export interface RouterEvent {
  id: number;
  conversationId?: string;
  messageId?: string;
  eventType: RouterEventType;
  providerId?: string;
  attemptNumber?: number;
  latencyMs?: number;
  errorType?: string;
  errorMessage?: string;
  createdAt: number;
}

export interface LogEventInput {
  conversationId?: string;
  messageId?: string;
  eventType: RouterEventType;
  providerId?: string;
  attemptNumber?: number;
  latencyMs?: number;
  errorType?: string;
  errorMessage?: string;
}

function rowToEvent(row: RouterEventRow): RouterEvent {
  return {
    id: row.id,
    conversationId: row.conversation_id ?? undefined,
    messageId: row.message_id ?? undefined,
    eventType: row.event_type,
    providerId: row.provider_id ?? undefined,
    attemptNumber: row.attempt_number ?? undefined,
    latencyMs: row.latency_ms ?? undefined,
    errorType: row.error_type ?? undefined,
    errorMessage: row.error_message ?? undefined,
    createdAt: new Date(row.created_at).getTime(),
  };
}

export const routerEventsRepo = {
  /**
   * Log a router event
   */
  log(event: LogEventInput): number {
    const result = execute(
      `INSERT INTO router_events (
        conversation_id, message_id, event_type, provider_id,
        attempt_number, latency_ms, error_type, error_message
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        event.conversationId ?? null,
        event.messageId ?? null,
        event.eventType,
        event.providerId ?? null,
        event.attemptNumber ?? null,
        event.latencyMs ?? null,
        event.errorType ?? null,
        event.errorMessage ?? null,
      ]
    );
    saveDatabase();

    return result.lastInsertRowid;
  },

  /**
   * Get recent events (for debugging)
   */
  getRecent(limit: number = 100): RouterEvent[] {
    const rows = query<RouterEventRow>(
      'SELECT * FROM router_events ORDER BY created_at DESC LIMIT ?',
      [limit]
    );
    return rows.map(rowToEvent);
  },

  /**
   * Get events for a specific message
   */
  getByMessage(messageId: string): RouterEvent[] {
    const rows = query<RouterEventRow>(
      'SELECT * FROM router_events WHERE message_id = ? ORDER BY created_at ASC',
      [messageId]
    );
    return rows.map(rowToEvent);
  },

  /**
   * Get events for a specific provider
   */
  getByProvider(providerId: string, limit: number = 50): RouterEvent[] {
    const rows = query<RouterEventRow>(
      'SELECT * FROM router_events WHERE provider_id = ? ORDER BY created_at DESC LIMIT ?',
      [providerId, limit]
    );
    return rows.map(rowToEvent);
  },

  /**
   * Clean up old events (keep last N days)
   */
  cleanup(daysToKeep: number = 7): number {
    const result = execute(
      "DELETE FROM router_events WHERE created_at < datetime('now', '-' || ? || ' days')",
      [daysToKeep]
    );
    saveDatabase();
    return result.changes;
  },
};
