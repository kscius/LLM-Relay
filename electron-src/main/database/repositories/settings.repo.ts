import { query, queryOne, execute, saveDatabase } from '../sqlite.js';

export interface AppSettings {
  showProviderBadge: boolean;
  theme: 'dark' | 'light' | 'system';
  systemPrompt: string;
}

const defaultSettings: AppSettings = {
  showProviderBadge: true,
  theme: 'dark',
  systemPrompt: '',
};

function parseValue(key: string, value: string): boolean | string | number {
  switch (key) {
    case 'showProviderBadge':
      return value === 'true';
    case 'theme':
      return value as 'dark' | 'light' | 'system';
    case 'systemPrompt':
      return value;
    default:
      return value;
  }
}

function stringifyValue(value: boolean | string | number): string {
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  return String(value);
}

export const settingsRepo = {
  /**
   * Get all settings
   */
  getAll(): AppSettings {
    const rows = query<{ key: string; value: string }>('SELECT key, value FROM settings');

    const settings: AppSettings = { ...defaultSettings };

    for (const row of rows) {
      if (row.key === 'showProviderBadge') {
        settings.showProviderBadge = row.value === 'true';
      } else if (row.key === 'theme') {
        settings.theme = row.value as 'dark' | 'light' | 'system';
      } else if (row.key === 'systemPrompt') {
        settings.systemPrompt = row.value;
      }
    }

    return settings;
  },

  /**
   * Get a single setting
   */
  get<K extends keyof AppSettings>(key: K): AppSettings[K] {
    const row = queryOne<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key]);

    if (!row) {
      return defaultSettings[key];
    }

    return parseValue(key, row.value) as AppSettings[K];
  },

  /**
   * Set a single setting
   */
  set<K extends keyof AppSettings>(key: K, value: AppSettings[K]): void {
    const stringValue = stringifyValue(value);

    execute(
      `INSERT INTO settings (key, value, updated_at)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at`,
      [key, stringValue]
    );
    saveDatabase();
  },

  /**
   * Set multiple settings at once
   */
  setAll(settings: Partial<AppSettings>): AppSettings {
    for (const [key, value] of Object.entries(settings)) {
      if (value !== undefined) {
        execute(
          `INSERT INTO settings (key, value, updated_at)
          VALUES (?, ?, datetime('now'))
          ON CONFLICT(key) DO UPDATE SET
            value = excluded.value,
            updated_at = excluded.updated_at`,
          [key, stringifyValue(value)]
        );
      }
    }
    saveDatabase();

    return this.getAll();
  },

  /**
   * Reset settings to defaults
   */
  reset(): AppSettings {
    return this.setAll(defaultSettings);
  },
};
