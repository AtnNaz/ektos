import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const g = globalThis as unknown as { __ektosDb?: DatabaseSync };

function db(): DatabaseSync {
  if (g.__ektosDb) return g.__ektosDb;
  const path = resolve(process.env.DATABASE_PATH || '.data/ektos.db');
  mkdirSync(dirname(path), { recursive: true });
  const d = new DatabaseSync(path);
  d.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY, created_at TEXT NOT NULL, name TEXT, email TEXT, message TEXT NOT NULL, lang TEXT);
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY, uploaded_at TEXT NOT NULL, fingerprint TEXT NOT NULL UNIQUE,
      when_run TEXT, observer INTEGER, field TEXT, data TEXT NOT NULL);
  `);
  g.__ektosDb = d;
  return d;
}

export type Message = { id: number; created_at: string; name: string | null; email: string | null; message: string; lang: string | null };
export type StoredSession = { id: number; uploaded_at: string; when_run: string | null; observer: number | null; field: string | null; data: string };

export function addMessage(m: { name: string | null; email: string | null; message: string; lang: string }) {
  db().prepare('INSERT INTO messages (created_at, name, email, message, lang) VALUES (?, ?, ?, ?, ?)')
    .run(new Date().toISOString(), m.name, m.email, m.message, m.lang);
}
export function listMessages(): Message[] {
  return db().prepare('SELECT * FROM messages ORDER BY id DESC LIMIT 500').all() as unknown as Message[];
}

export function addSession(s: { fingerprint: string; when: string | null; observer: number | null; field: string | null; data: string }): boolean {
  const r = db().prepare('INSERT OR IGNORE INTO sessions (uploaded_at, fingerprint, when_run, observer, field, data) VALUES (?, ?, ?, ?, ?, ?)')
    .run(new Date().toISOString(), s.fingerprint, s.when, s.observer, s.field, s.data);
  return Number(r.changes) > 0;
}
export function listSessions(): StoredSession[] {
  return db().prepare('SELECT id, uploaded_at, when_run, observer, field, data FROM sessions ORDER BY id DESC').all() as unknown as StoredSession[];
}
export function countSessions(): number {
  return Number((db().prepare('SELECT COUNT(*) AS n FROM sessions').get() as { n: number }).n);
}
