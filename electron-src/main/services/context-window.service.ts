// Sliding window for LLM context - keeps last N messages

import { execute, saveDatabase, queryOne } from '../database/sqlite.js';

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

const DEFAULT_WINDOW = 20;

class ContextWindowService {
  getMaxMessages(): number {
    const row = queryOne<{ value: string }>('SELECT value FROM settings WHERE key = ?', ['contextWindowSize']);
    if (row) {
      const n = parseInt(row.value, 10);
      if (!isNaN(n) && n > 0) return n;
    }
    return DEFAULT_WINDOW;
  }

  setMaxMessages(size: number): void {
    if (size > 0 && size <= 100) {
      execute(
        `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        ['contextWindowSize', size.toString()]
      );
      saveDatabase();
    }
  }

  applyWindow(messages: ChatMessage[]): ChatMessage[] {
    const max = this.getMaxMessages();
    const sysMsgs = messages.filter(m => m.role === 'system');
    const convMsgs = messages.filter(m => m.role !== 'system');

    if (convMsgs.length <= max) return messages;

    const trimmed = convMsgs.length - max;
    console.log(`context: trimmed ${trimmed} msgs, keeping ${max}`);

    return [...sysMsgs, ...convMsgs.slice(-max)];
  }

  estimateTokens(msgs: ChatMessage[]): number {
    const chars = msgs.reduce((sum, m) => sum + m.content.length, 0);
    return Math.ceil(chars / 4); // rough ~4 chars per token
  }

  getStats(all: ChatMessage[], windowed: ChatMessage[]) {
    return {
      totalMessages: all.length,
      windowedMessages: windowed.length,
      trimmedMessages: all.length - windowed.length,
      estimatedTokens: this.estimateTokens(windowed),
      windowSize: this.getMaxMessages(),
    };
  }
}

export const contextWindowService = new ContextWindowService();
