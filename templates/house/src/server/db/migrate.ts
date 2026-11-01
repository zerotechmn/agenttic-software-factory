import type Database from "better-sqlite3";

/**
 * Idempotent schema bootstrap. Keep in sync with schema.ts: one CREATE TABLE IF NOT EXISTS per table.
 * (No migration tool on purpose — the DB is created fresh on boot.)
 */
export function migrate(sqlite: Database.Database): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
}
