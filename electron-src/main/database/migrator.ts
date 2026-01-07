import fs from 'fs';
import path from 'path';
import { execRaw, query, execute, saveDatabase } from './sqlite.js';

interface Migration {
  version: number;
  name: string;
  sql: string;
}

interface MigrationRow {
  version: number;
}

/**
 * Ensure the schema_migrations table exists
 */
function ensureMigrationsTable(): void {
  execRaw(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
}

/**
 * Get the current schema version
 */
function getCurrentVersion(): number {
  try {
    const result = query<MigrationRow>('SELECT MAX(version) as version FROM schema_migrations');
    return result[0]?.version ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Parse migration files from the migrations directory
 */
function parseMigrations(migrationsPath: string): Migration[] {
  if (!fs.existsSync(migrationsPath)) {
    console.warn(`Migrations directory not found: ${migrationsPath}`);
    return [];
  }

  const files = fs.readdirSync(migrationsPath)
    .filter(f => f.endsWith('.sql'))
    .sort();

  const migrations: Migration[] = [];

  for (const file of files) {
    // Expected format: 001_initial.sql, 002_add_index.sql, etc.
    const match = file.match(/^(\d+)_(.+)\.sql$/);
    if (!match) {
      console.warn(`Skipping invalid migration file: ${file}`);
      continue;
    }

    const version = parseInt(match[1], 10);
    const name = match[2];
    const sql = fs.readFileSync(path.join(migrationsPath, file), 'utf-8');

    migrations.push({ version, name, sql });
  }

  return migrations;
}

/**
 * Apply a single migration
 */
function applyMigration(migration: Migration): void {
  // Execute the migration SQL
  execRaw(migration.sql);

  // Record the migration
  execute(
    'INSERT INTO schema_migrations (version, name) VALUES (?, ?)',
    [migration.version, migration.name]
  );

  saveDatabase();

  console.info(`Applied migration ${migration.version}: ${migration.name}`);
}

/**
 * Run all pending migrations
 */
export async function runMigrations(migrationsPath: string): Promise<void> {
  ensureMigrationsTable();

  const currentVersion = getCurrentVersion();
  const migrations = parseMigrations(migrationsPath);
  const pending = migrations.filter(m => m.version > currentVersion);

  if (pending.length === 0) {
    console.info('No pending migrations');
    return;
  }

  console.info(`Running ${pending.length} pending migration(s)...`);

  for (const migration of pending) {
    applyMigration(migration);
  }

  console.info('All migrations applied successfully');
}

/**
 * Get migration status
 */
export function getMigrationStatus(): { version: number; pending: number } {
  const currentVersion = getCurrentVersion();
  return { version: currentVersion, pending: 0 };
}
