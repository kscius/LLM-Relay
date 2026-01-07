import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
import fs from 'fs';
import path from 'path';

let db: SqlJsDatabase | null = null;
let dbPath: string | null = null;

/**
 * Initialize the SQLite database connection using sql.js
 */
export async function initDatabase(filePath: string): Promise<SqlJsDatabase> {
  if (db) {
    return db;
  }

  dbPath = filePath;

  // Initialize sql.js
  const SQL = await initSqlJs();

  // Check if database file exists
  if (fs.existsSync(filePath)) {
    const fileBuffer = fs.readFileSync(filePath);
    db = new SQL.Database(fileBuffer);
  } else {
    // Create new database
    db = new SQL.Database();
    // Ensure directory exists
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  // Enable foreign keys
  db.run('PRAGMA foreign_keys = ON');

  return db;
}

/**
 * Get the database instance
 */
export function getDatabase(): SqlJsDatabase {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase first.');
  }
  return db;
}

/**
 * Save database to disk
 */
export function saveDatabase(): void {
  if (!db || !dbPath) return;

  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(dbPath, buffer);
}

/**
 * Close the database connection
 */
export function closeDatabase(): void {
  if (db) {
    saveDatabase();
    db.close();
    db = null;
    dbPath = null;
  }
}

/**
 * Run a transaction with automatic save
 */
export function transaction<T>(fn: () => T): T {
  const database = getDatabase();
  database.run('BEGIN TRANSACTION');
  try {
    const result = fn();
    database.run('COMMIT');
    saveDatabase();
    return result;
  } catch (error) {
    database.run('ROLLBACK');
    throw error;
  }
}

/**
 * Helper to run a query and get results
 */
export function query<T>(sql: string, params: unknown[] = []): T[] {
  const database = getDatabase();
  const stmt = database.prepare(sql);
  stmt.bind(params);

  const results: T[] = [];
  while (stmt.step()) {
    const row = stmt.getAsObject() as T;
    results.push(row);
  }
  stmt.free();

  return results;
}

/**
 * Helper to run a single query and get one result
 */
export function queryOne<T>(sql: string, params: unknown[] = []): T | undefined {
  const results = query<T>(sql, params);
  return results[0];
}

/**
 * Helper to execute a statement (INSERT, UPDATE, DELETE)
 */
export function execute(sql: string, params: unknown[] = []): { changes: number; lastInsertRowid: number } {
  const database = getDatabase();
  database.run(sql, params);

  // Get changes and last insert rowid
  const changesResult = database.exec('SELECT changes() as changes, last_insert_rowid() as lastId');
  const changes = changesResult[0]?.values[0]?.[0] as number ?? 0;
  const lastInsertRowid = changesResult[0]?.values[0]?.[1] as number ?? 0;

  return { changes, lastInsertRowid };
}

/**
 * Helper to execute raw SQL (for migrations)
 */
export function execRaw(sql: string): void {
  const database = getDatabase();
  database.exec(sql);
  saveDatabase();
}
