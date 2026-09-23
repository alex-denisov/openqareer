/**
 * Схема трекера откликов, вынесена из `sqliteSchema.ts`, чтобы держать оба
 * файла под гейтом 800 строк (coding-style.md: many small files).
 *
 * B251 срез 1 — модель трекера откликов (system-architect, вариант B).
 *
 * `application_events.provenance = 'system'` (S2) marks the automatic archive
 * event fired when a tracked vacancy disappears from the pool (architecture.md
 * §4, owner decision 2026-09-23 22:26): the candidate did not close the card,
 * the system did.
 *
 * Только `CREATE TABLE/INDEX IF NOT EXISTS` на пустых таблицах: прод-БД
 * 3.8 GB, окно здоровья выката 20 с не переживает `ALTER TABLE` (B230).
 * `vacancy_applications` (MIGRATION_28) не трогаем — она остаётся фасадом
 * для старого `.app`. Свободный текст (заметки, снимок вакансии, условия
 * оффера, подготовка и debrief интервью) шифруется через `sealedText` в коде
 * репозитория, поэтому колонки называются `*_cipher`; этапы и даты хранятся
 * открыто, чтобы воронка считалась SQL-запросом.
 */
export const MIGRATION_33 = `
CREATE TABLE IF NOT EXISTS applications (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  cluster_id TEXT,
  stage TEXT NOT NULL CHECK (stage IN (
    'saved', 'applied', 'responded', 'interview', 'offer', 'rejected', 'archived'
  )),
  closed_reason TEXT,
  process_profile TEXT NOT NULL DEFAULT 'standard' CHECK (process_profile IN ('standard', 'executive')),
  vacancy_cipher TEXT,
  notes_cipher TEXT,
  follow_up_due_at TEXT,
  stage_changed_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
CREATE UNIQUE INDEX IF NOT EXISTS applications_candidate_cluster
  ON applications(candidate_id, cluster_id) WHERE cluster_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS applications_candidate_stage
  ON applications(candidate_id, stage);

CREATE TABLE IF NOT EXISTS application_events (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN (
    'stage', 'note', 'follow_up_sent', 'thank_you_sent', 'promise', 'material'
  )),
  from_stage TEXT,
  to_stage TEXT,
  occurred_at TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  provenance TEXT NOT NULL CHECK (provenance IN ('candidate', 'migrated', 'legacy_client', 'system')),
  payload_cipher TEXT
) STRICT;
CREATE INDEX IF NOT EXISTS application_events_by_application
  ON application_events(application_id, occurred_at);

CREATE TABLE IF NOT EXISTS application_materials (
  application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('cover_letter', 'resume')),
  document_id TEXT NOT NULL,
  linked_at TEXT NOT NULL,
  PRIMARY KEY (application_id, role)
) STRICT;

CREATE TABLE IF NOT EXISTS application_interviews (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  round INTEGER NOT NULL,
  scheduled_at TEXT,
  format TEXT,
  prep_status TEXT NOT NULL DEFAULT 'none' CHECK (prep_status IN ('none', 'ready')),
  prep_cipher TEXT,
  debrief_cipher TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS application_interviews_by_application
  ON application_interviews(application_id, scheduled_at);

CREATE TABLE IF NOT EXISTS application_offers (
  application_id TEXT PRIMARY KEY REFERENCES applications(id) ON DELETE CASCADE,
  terms_cipher TEXT NOT NULL,
  respond_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS vacancy_skips (
  candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  cluster_id TEXT NOT NULL,
  reason_id TEXT NOT NULL CHECK (reason_id IN (
    'role-family', 'level', 'geo-format', 'comp-below',
    'company', 'duplicate', 'unverified', 'stale'
  )),
  origin TEXT NOT NULL CHECK (origin IN ('vacancy_card', 'kanban')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (candidate_id, cluster_id)
) STRICT;

CREATE TABLE IF NOT EXISTS candidate_visits (
  candidate_id TEXT PRIMARY KEY REFERENCES candidates(id) ON DELETE CASCADE,
  last_visited_at TEXT,
  previous_visited_at TEXT
) STRICT;

CREATE TABLE IF NOT EXISTS candidate_outreach (
  candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  client_record_id TEXT NOT NULL,
  application_id TEXT REFERENCES applications(id) ON DELETE SET NULL,
  contact_cipher TEXT NOT NULL,
  status TEXT NOT NULL,
  sent_at TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (candidate_id, client_record_id)
) STRICT;
`;
