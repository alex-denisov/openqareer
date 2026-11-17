import { DIARY_ENTRY_KINDS } from '../../shared/careerDiaryEntries';

/**
 * B683: записи дневника и итоги недель. Только добавление: новые таблицы рядом с
 * `career_diary_*`, прежние таблицы и их строки не меняются. Текст записи и итог
 * лежат в `payload_cipher`; открыты дата, тип и цель — по ним лента фильтруется.
 */
export const DIARY_ENTRIES_MIGRATION = [
  `CREATE TABLE IF NOT EXISTS career_diary_entries (
    candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    entry_date TEXT NOT NULL CHECK (length(entry_date) = 10),
    kind TEXT NOT NULL CHECK (kind IN (${DIARY_ENTRY_KINDS.map((kind) => `'${kind}'`).join(', ')})),
    goal_id TEXT,
    idempotency_key TEXT,
    payload_cipher TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (candidate_id, id)
  ) STRICT;`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_career_diary_entries_key
    ON career_diary_entries(candidate_id, idempotency_key) WHERE idempotency_key IS NOT NULL;`,
  `CREATE INDEX IF NOT EXISTS idx_career_diary_entries_feed
    ON career_diary_entries(candidate_id, entry_date DESC, created_at DESC, id DESC);`,
  `CREATE TABLE IF NOT EXISTS career_diary_week_summaries (
    candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
    week_start TEXT NOT NULL CHECK (length(week_start) = 10),
    payload_cipher TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (candidate_id, week_start)
  ) STRICT;`,
].join('\n');
