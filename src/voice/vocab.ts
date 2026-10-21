/**
 * Shared vocabulary for STT hints and TTS pronunciation.
 * Stored in SQLite; seeded with common Nigerian names and places.
 */

import { db } from '../db/index.ts';

export interface VocabRow {
  id: number;
  term: string;
  kind: string;
  pronunciation: string | null;
  created_at: string;
}

function all<T>(sql: string, ...params: unknown[]): T[] {
  return db().prepare(sql).all(...(params as never[])) as unknown as T[];
}

function one<T>(sql: string, ...params: unknown[]): T {
  return db().prepare(sql).get(...(params as never[])) as unknown as T;
}

const SEED: { term: string; kind: string; pronunciation?: string }[] = [
  { term: 'Ikeja', kind: 'place', pronunciation: 'ee-KAY-jah' },
  { term: 'Lekki', kind: 'place', pronunciation: 'LEH-kee' },
  { term: 'Yaba', kind: 'place', pronunciation: 'YAH-bah' },
  { term: 'Ojuelegba', kind: 'place', pronunciation: 'oh-joo-eh-LEG-bah' },
  { term: 'Surulere', kind: 'place', pronunciation: 'soo-roo-LEH-reh' },
  { term: 'Abuja', kind: 'place', pronunciation: 'ah-BOO-jah' },
  { term: 'Lagos', kind: 'place', pronunciation: 'LAY-goss' },
  { term: 'Ibadan', kind: 'place', pronunciation: 'ee-BAH-dan' },
  { term: 'Adaeze', kind: 'name', pronunciation: 'ah-dah-EH-zeh' },
  { term: 'Adanna', kind: 'name', pronunciation: 'ah-DAH-nah' },
  { term: 'Chinedu', kind: 'name', pronunciation: 'chee-NEH-doo' },
  { term: 'Ngozi', kind: 'name', pronunciation: 'n-GOH-zee' },
  { term: 'Olumide', kind: 'name', pronunciation: 'oh-loo-MEE-deh' },
  { term: 'Funke', kind: 'name', pronunciation: 'FOON-keh' },
  { term: 'Bola', kind: 'name', pronunciation: 'BOH-lah' },
  { term: 'Tunde', kind: 'name', pronunciation: 'TOON-deh' },
  { term: 'Naira', kind: 'term', pronunciation: 'NYE-rah' },
  { term: 'Spendprofile', kind: 'product', pronunciation: 'Spend Profile' },
  { term: 'wahala', kind: 'pidgin', pronunciation: 'wah-HAH-lah' },
  { term: 'abeg', kind: 'pidgin', pronunciation: 'ah-beg' },
];

export function ensureVocabTable(): void {
  db().exec(`
    CREATE TABLE IF NOT EXISTS va_vocabulary (
      id            INTEGER PRIMARY KEY,
      term          TEXT NOT NULL UNIQUE,
      kind          TEXT NOT NULL DEFAULT 'term',
      pronunciation TEXT,
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  const count = one<{ c: number }>(`SELECT COUNT(*) AS c FROM va_vocabulary`).c;
  if (count === 0) {
    for (const s of SEED) {
      db()
        .prepare(
          `INSERT OR IGNORE INTO va_vocabulary (term, kind, pronunciation) VALUES (?, ?, ?)`,
        )
        .run(s.term, s.kind, s.pronunciation ?? null);
    }
  }
}

export function listVocab(limit = 200): VocabRow[] {
  ensureVocabTable();
  return all<VocabRow>(
    `SELECT * FROM va_vocabulary ORDER BY lower(term) ASC LIMIT ?`,
    Math.min(Math.max(limit, 1), 500),
  );
}

export function addVocab(term: string, kind = 'term', pronunciation?: string | null): VocabRow {
  ensureVocabTable();
  const t = term.trim().slice(0, 80);
  if (!t) throw new Error('Term is required');
  return one<VocabRow>(
    `INSERT INTO va_vocabulary (term, kind, pronunciation)
     VALUES (?, ?, ?)
     ON CONFLICT(term) DO UPDATE SET
       kind = excluded.kind,
       pronunciation = COALESCE(excluded.pronunciation, va_vocabulary.pronunciation)
     RETURNING *`,
    t,
    kind.slice(0, 40),
    pronunciation?.trim() || null,
  );
}

export function removeVocab(id: number): boolean {
  ensureVocabTable();
  return Number(db().prepare(`DELETE FROM va_vocabulary WHERE id = ?`).run(id).changes) > 0;
}

/** Compact prompt hint for Whisper (max ~224 tokens; keep short). */
export function whisperPromptHint(maxChars = 800): string {
  const rows = listVocab(80);
  if (!rows.length) {
    return 'Nigerian English. Names and places: Ikeja, Lekki, Yaba, Ojuelegba, Adaeze, Funke, Lagos.';
  }
  const terms = rows.map((r) => r.term).join(', ');
  const base =
    'Nigerian English and Pidgin. Prefer these spellings for names and places: ';
  return (base + terms).slice(0, maxChars);
}

/** Map of display term → spoken form for TTS. */
export function pronunciationMap(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of listVocab(300)) {
    if (r.pronunciation) out[r.term] = r.pronunciation;
  }
  return out;
}
