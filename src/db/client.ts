import Database from 'better-sqlite3';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import { applySchema } from './schema.js';

export const DEFAULT_DB_PATH = process.env.STRAVA_DB_PATH ?? 'data/strava.db';

export function openDatabase(dbPath = DEFAULT_DB_PATH): Database.Database {
  if (dbPath !== ':memory:') {
    mkdirSync(dirname(dbPath), { recursive: true });
  }

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  applySchema(db);
  return db;
}
