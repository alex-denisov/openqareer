export const MIGRATION_1 = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
) STRICT;

CREATE TABLE candidates (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  data_class TEXT NOT NULL CHECK (data_class IN ('synthetic', 'personal')),
  locale TEXT NOT NULL CHECK (locale IN ('ru-RU', 'en-US')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL UNIQUE REFERENCES candidates(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE messages (
  id TEXT NOT NULL,
  candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  body_cipher TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (candidate_id, id)
) STRICT;

CREATE INDEX messages_conversation_created
  ON messages(conversation_id, created_at, id);

CREATE TABLE turns (
  candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_message_id TEXT NOT NULL,
  assistant_message_id TEXT,
  phase TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'failed', 'completed')),
  result_cipher TEXT,
  provider TEXT,
  model TEXT,
  response_id TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  total_tokens INTEGER,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (candidate_id, idempotency_key)
) STRICT;

CREATE TABLE memory (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  statement_cipher TEXT NOT NULL,
  confidence TEXT NOT NULL,
  source_message_ids TEXT NOT NULL,
  sensitive INTEGER NOT NULL CHECK (sensitive IN (0, 1)),
  status TEXT NOT NULL CHECK (
    status IN ('proposed', 'confirmed', 'corrected', 'deleted')
  ),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE INDEX memory_candidate_status ON memory(candidate_id, status);

CREATE TABLE memory_revisions (
  id TEXT PRIMARY KEY,
  memory_id TEXT NOT NULL REFERENCES memory(id) ON DELETE CASCADE,
  candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('confirm', 'correct', 'delete')),
  previous_digest TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;
`;

export const MIGRATION_2 = `
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('candidate', 'admin')),
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  candidate_id TEXT UNIQUE REFERENCES candidates(id) ON DELETE CASCADE,
  is_test INTEGER NOT NULL CHECK (is_test IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (
    (role = 'candidate' AND candidate_id IS NOT NULL) OR
    (role = 'admin' AND candidate_id IS NULL)
  )
) STRICT;

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
) STRICT;

CREATE INDEX sessions_user ON sessions(user_id);
CREATE INDEX sessions_expiry ON sessions(expires_at);
`;

export const MIGRATION_3 = `
ALTER TABLE memory
  ADD COLUMN domain TEXT NOT NULL DEFAULT 'other'
  CHECK (
    domain IN (
      'responsibility', 'outcome', 'skill', 'preference', 'constraint',
      'gap', 'role-evidence', 'other'
    )
  );
`;

export const MIGRATION_4 = `
CREATE TABLE assessments (
  candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  assessment_id TEXT NOT NULL CHECK (
    assessment_id IN ('work-preferences-v1', 'product-case-v1')
  ),
  submission_cipher TEXT NOT NULL,
  result_cipher TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (candidate_id, assessment_id)
) STRICT;
`;

export const MIGRATION_5 = `
CREATE TABLE market_profiles (
  candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  country TEXT NOT NULL CHECK (country = 'DE'),
  submission_cipher TEXT NOT NULL,
  result_cipher TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (candidate_id, country)
) STRICT;
`;

/**
 * Was the platform-authorisation step. There is no official OAuth for hh.ru or
 * LinkedIn and there cannot be one, so the owner removed the concept from the
 * product entirely (ADR-009, B163). The tables it used to create are dropped
 * by `MIGRATION_21` on databases that already have them; a database created
 * from here on never holds them at all. The version number stays, because
 * `schema_migrations` on live databases already records it.
 */
export const MIGRATION_6 = `
SELECT 1;
`;

export const MIGRATION_7 = `
ALTER TABLE turns ADD COLUMN request_digest TEXT;
`;

export const MIGRATION_8 = `
CREATE TABLE career_commands (
  candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  command_id TEXT NOT NULL,
  capability TEXT NOT NULL,
  payload_digest TEXT NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN (
      'awaiting_approval', 'prepared', 'queued', 'executing',
      'completed_with_receipt', 'paused', 'failed', 'native_handoff'
    )
  ),
  command_cipher TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (candidate_id, command_id)
) STRICT;

CREATE TABLE career_command_approvals (
  approval_id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  command_id TEXT NOT NULL,
  capability TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (candidate_id, command_id)
    REFERENCES career_commands(candidate_id, command_id) ON DELETE CASCADE
) STRICT;

CREATE TABLE career_command_outbox (
  candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  command_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'delivered')),
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (candidate_id, command_id),
  FOREIGN KEY (candidate_id, command_id)
    REFERENCES career_commands(candidate_id, command_id) ON DELETE CASCADE
) STRICT;

CREATE INDEX career_command_outbox_pending
  ON career_command_outbox(status, created_at);
`;

export const MIGRATION_9 = `
ALTER TABLE users ADD COLUMN email TEXT;
ALTER TABLE users ADD COLUMN display_name TEXT;
ALTER TABLE users ADD COLUMN headline TEXT;
ALTER TABLE users ADD COLUMN location TEXT;
ALTER TABLE users ADD COLUMN work_mode TEXT CHECK (
  work_mode IS NULL OR work_mode IN ('office', 'hybrid', 'remote', 'flexible')
);
ALTER TABLE users ADD COLUMN profile_updated_at TEXT;

CREATE UNIQUE INDEX users_email_unique
  ON users(email) WHERE email IS NOT NULL;
`;

export const MIGRATION_10 = `
CREATE TABLE password_reset_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL
) STRICT;

CREATE INDEX password_reset_tokens_user
  ON password_reset_tokens(user_id, expires_at);
`;

export const MIGRATION_11 = `
CREATE TABLE candidate_documents (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  family_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  kind TEXT NOT NULL CHECK (
    kind IN (
      'resume', 'cover_letter', 'certificate', 'portfolio',
      'profile_export', 'other'
    )
  ),
  source TEXT NOT NULL CHECK (source IN ('upload', 'generated', 'import')),
  file_name_cipher TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size > 0 AND byte_size <= 5242880),
  content_sha256 TEXT NOT NULL,
  content_cipher TEXT,
  extracted_text_cipher TEXT,
  parse_status TEXT NOT NULL CHECK (
    parse_status IN ('pending', 'ready', 'failed', 'not_applicable')
  ),
  supersedes_document_id TEXT REFERENCES candidate_documents(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
) STRICT;

CREATE UNIQUE INDEX candidate_documents_active_hash
  ON candidate_documents(candidate_id, content_sha256)
  WHERE deleted_at IS NULL;
CREATE INDEX candidate_documents_candidate
  ON candidate_documents(candidate_id, kind, created_at);
`;

export const MIGRATION_12 = `
CREATE TABLE vacancy_subscriptions (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source = 'hh'),
  query_cipher TEXT NOT NULL,
  cadence_minutes INTEGER NOT NULL CHECK (
    cadence_minutes BETWEEN 60 AND 10080
  ),
  status TEXT NOT NULL CHECK (status IN ('active', 'paused')),
  next_run_at TEXT NOT NULL,
  last_attempt_at TEXT,
  last_success_at TEXT,
  last_error_code TEXT,
  lease_until TEXT,
  source_found INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE INDEX vacancy_subscriptions_due
  ON vacancy_subscriptions(status, next_run_at, lease_until);
CREATE INDEX vacancy_subscriptions_candidate
  ON vacancy_subscriptions(candidate_id, created_at);

CREATE TABLE vacancies (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL CHECK (source = 'hh'),
  external_id TEXT NOT NULL,
  canonical_url TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  latest_version INTEGER NOT NULL CHECK (latest_version > 0),
  UNIQUE (source, external_id)
) STRICT;

CREATE TABLE vacancy_versions (
  vacancy_id TEXT NOT NULL REFERENCES vacancies(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK (version > 0),
  content_hash TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  PRIMARY KEY (vacancy_id, version)
) STRICT;

CREATE TABLE vacancy_subscription_items (
  subscription_id TEXT NOT NULL REFERENCES vacancy_subscriptions(id) ON DELETE CASCADE,
  vacancy_id TEXT NOT NULL REFERENCES vacancies(id) ON DELETE CASCADE,
  first_matched_at TEXT NOT NULL,
  last_matched_at TEXT NOT NULL,
  PRIMARY KEY (subscription_id, vacancy_id)
) STRICT;

CREATE TABLE vacancy_source_health (
  source TEXT PRIMARY KEY CHECK (source = 'hh'),
  status TEXT NOT NULL CHECK (status IN ('healthy', 'degraded', 'unavailable')),
  last_attempt_at TEXT NOT NULL,
  last_success_at TEXT,
  last_error_code TEXT,
  retry_after_at TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0
) STRICT;
`;

export const MIGRATION_13 = `
ALTER TABLE candidate_documents ADD COLUMN retention_until TEXT;

CREATE INDEX candidate_documents_retention
  ON candidate_documents(retention_until, candidate_id)
  WHERE deleted_at IS NULL AND retention_until IS NOT NULL;
`;

export const MIGRATION_14 = `
CREATE TABLE vacancy_subscriptions_v14 (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('hh', 'arbeitnow')),
  query_cipher TEXT NOT NULL,
  cadence_minutes INTEGER NOT NULL CHECK (
    cadence_minutes BETWEEN 60 AND 10080
  ),
  status TEXT NOT NULL CHECK (status IN ('active', 'paused')),
  next_run_at TEXT NOT NULL,
  last_attempt_at TEXT,
  last_success_at TEXT,
  last_error_code TEXT,
  lease_until TEXT,
  source_found INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE vacancies_v14 (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL CHECK (source IN ('hh', 'arbeitnow')),
  external_id TEXT NOT NULL,
  canonical_url TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  latest_version INTEGER NOT NULL CHECK (latest_version > 0),
  UNIQUE (source, external_id)
) STRICT;

CREATE TABLE vacancy_versions_v14 (
  vacancy_id TEXT NOT NULL REFERENCES vacancies_v14(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK (version > 0),
  content_hash TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  PRIMARY KEY (vacancy_id, version)
) STRICT;

CREATE TABLE vacancy_subscription_items_v14 (
  subscription_id TEXT NOT NULL REFERENCES vacancy_subscriptions_v14(id) ON DELETE CASCADE,
  vacancy_id TEXT NOT NULL REFERENCES vacancies_v14(id) ON DELETE CASCADE,
  first_matched_at TEXT NOT NULL,
  last_matched_at TEXT NOT NULL,
  PRIMARY KEY (subscription_id, vacancy_id)
) STRICT;

CREATE TABLE vacancy_source_health_v14 (
  source TEXT PRIMARY KEY CHECK (source IN ('hh', 'arbeitnow')),
  status TEXT NOT NULL CHECK (
    status IN ('healthy', 'degraded', 'unavailable', 'official_access_required')
  ),
  last_attempt_at TEXT NOT NULL,
  last_success_at TEXT,
  last_error_code TEXT,
  retry_after_at TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0
) STRICT;

INSERT INTO vacancy_subscriptions_v14 SELECT * FROM vacancy_subscriptions;
INSERT INTO vacancies_v14 SELECT * FROM vacancies;
INSERT INTO vacancy_versions_v14 SELECT * FROM vacancy_versions;
INSERT INTO vacancy_subscription_items_v14 SELECT * FROM vacancy_subscription_items;
INSERT INTO vacancy_source_health_v14 SELECT * FROM vacancy_source_health;

DROP TABLE vacancy_subscription_items;
DROP TABLE vacancy_versions;
DROP TABLE vacancies;
DROP TABLE vacancy_subscriptions;
DROP TABLE vacancy_source_health;

ALTER TABLE vacancy_subscriptions_v14 RENAME TO vacancy_subscriptions;
ALTER TABLE vacancies_v14 RENAME TO vacancies;
ALTER TABLE vacancy_versions_v14 RENAME TO vacancy_versions;
ALTER TABLE vacancy_subscription_items_v14 RENAME TO vacancy_subscription_items;
ALTER TABLE vacancy_source_health_v14 RENAME TO vacancy_source_health;

CREATE INDEX vacancy_subscriptions_due
  ON vacancy_subscriptions(status, next_run_at, lease_until);
CREATE INDEX vacancy_subscriptions_candidate
  ON vacancy_subscriptions(candidate_id, created_at);
`;

export const MIGRATION_15 = `
CREATE TABLE vacancy_subscriptions_v15 (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('hh', 'remotive')),
  query_cipher TEXT NOT NULL,
  cadence_minutes INTEGER NOT NULL CHECK (
    cadence_minutes BETWEEN 60 AND 10080
  ),
  status TEXT NOT NULL CHECK (status IN ('active', 'paused')),
  next_run_at TEXT NOT NULL,
  last_attempt_at TEXT,
  last_success_at TEXT,
  last_error_code TEXT,
  lease_until TEXT,
  source_found INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE vacancies_v15 (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL CHECK (source IN ('hh', 'remotive')),
  external_id TEXT NOT NULL,
  canonical_url TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  latest_version INTEGER NOT NULL CHECK (latest_version > 0),
  UNIQUE (source, external_id)
) STRICT;

CREATE TABLE vacancy_versions_v15 (
  vacancy_id TEXT NOT NULL REFERENCES vacancies_v15(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK (version > 0),
  content_hash TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  PRIMARY KEY (vacancy_id, version)
) STRICT;

CREATE TABLE vacancy_subscription_items_v15 (
  subscription_id TEXT NOT NULL REFERENCES vacancy_subscriptions_v15(id) ON DELETE CASCADE,
  vacancy_id TEXT NOT NULL REFERENCES vacancies_v15(id) ON DELETE CASCADE,
  first_matched_at TEXT NOT NULL,
  last_matched_at TEXT NOT NULL,
  PRIMARY KEY (subscription_id, vacancy_id)
) STRICT;

CREATE TABLE vacancy_source_health_v15 (
  source TEXT PRIMARY KEY CHECK (source IN ('hh', 'remotive')),
  status TEXT NOT NULL CHECK (
    status IN ('healthy', 'degraded', 'unavailable', 'official_access_required')
  ),
  last_attempt_at TEXT NOT NULL,
  last_success_at TEXT,
  last_error_code TEXT,
  retry_after_at TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0
) STRICT;

INSERT INTO vacancy_subscriptions_v15
  SELECT id, candidate_id,
    CASE source WHEN 'arbeitnow' THEN 'remotive' ELSE source END,
    query_cipher, cadence_minutes,
    CASE source WHEN 'arbeitnow' THEN 'paused' ELSE status END,
    next_run_at,
    CASE source WHEN 'arbeitnow' THEN NULL ELSE last_attempt_at END,
    CASE source WHEN 'arbeitnow' THEN NULL ELSE last_success_at END,
    CASE source WHEN 'arbeitnow' THEN 'source_replaced_review_required'
      ELSE last_error_code END,
    NULL,
    CASE source WHEN 'arbeitnow' THEN NULL ELSE source_found END,
    created_at,
    CASE source WHEN 'arbeitnow' THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      ELSE updated_at END
  FROM vacancy_subscriptions;

INSERT INTO vacancies_v15 SELECT * FROM vacancies WHERE source = 'hh';
INSERT INTO vacancy_versions_v15
  SELECT versions.* FROM vacancy_versions AS versions
  JOIN vacancies ON vacancies.id = versions.vacancy_id
  WHERE vacancies.source = 'hh';
INSERT INTO vacancy_subscription_items_v15
  SELECT items.* FROM vacancy_subscription_items AS items
  JOIN vacancy_subscriptions AS subscriptions
    ON subscriptions.id = items.subscription_id
  JOIN vacancies ON vacancies.id = items.vacancy_id
  WHERE subscriptions.source = 'hh' AND vacancies.source = 'hh';
INSERT INTO vacancy_source_health_v15
  SELECT * FROM vacancy_source_health WHERE source = 'hh';

DROP TABLE vacancy_subscription_items;
DROP TABLE vacancy_versions;
DROP TABLE vacancies;
DROP TABLE vacancy_subscriptions;
DROP TABLE vacancy_source_health;

ALTER TABLE vacancy_subscriptions_v15 RENAME TO vacancy_subscriptions;
ALTER TABLE vacancies_v15 RENAME TO vacancies;
ALTER TABLE vacancy_versions_v15 RENAME TO vacancy_versions;
ALTER TABLE vacancy_subscription_items_v15 RENAME TO vacancy_subscription_items;
ALTER TABLE vacancy_source_health_v15 RENAME TO vacancy_source_health;

CREATE INDEX vacancy_subscriptions_due
  ON vacancy_subscriptions(status, next_run_at, lease_until);
CREATE INDEX vacancy_subscriptions_candidate
  ON vacancy_subscriptions(candidate_id, created_at);
`;

export const MIGRATION_16 = `
CREATE TABLE resume_drafts (
  candidate_id TEXT PRIMARY KEY REFERENCES candidates(id) ON DELETE CASCADE,
  draft_cipher TEXT NOT NULL,
  evidence_snapshot_cipher TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
`;

export const MIGRATION_17 = `
CREATE TABLE IF NOT EXISTS admin_audit (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT NOT NULL,
  actor_username TEXT NOT NULL,
  action TEXT NOT NULL,
  subject_user_id TEXT,
  subject_username TEXT,
  detail TEXT,
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS admin_audit_created ON admin_audit(created_at);
`;

export const MIGRATION_18 = `
ALTER TABLE users ADD COLUMN blocked_at TEXT;
ALTER TABLE users ADD COLUMN subscription_tier TEXT NOT NULL DEFAULT 'free' CHECK (subscription_tier IN ('free', 'pro', 'executive', 'enterprise'));
ALTER TABLE users ADD COLUMN subscription_status TEXT NOT NULL DEFAULT 'active' CHECK (subscription_status IN ('active', 'trialing', 'past_due', 'canceled'));
ALTER TABLE users ADD COLUMN subscription_expires_at TEXT;
ALTER TABLE users ADD COLUMN subscription_notes TEXT;
`;

export const MIGRATION_19 = `
CREATE TABLE candidate_source_connections (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('hh', 'linkedin')),
  access_mode TEXT NOT NULL CHECK (access_mode = 'native_session_snapshot'),
  source_message_id TEXT NOT NULL,
  receipt_cipher TEXT NOT NULL,
  import_digest TEXT NOT NULL,
  connected_at TEXT NOT NULL,
  last_imported_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (candidate_id, platform),
  FOREIGN KEY (candidate_id, source_message_id)
    REFERENCES messages(candidate_id, id) ON DELETE RESTRICT
) STRICT;

CREATE UNIQUE INDEX candidate_source_connections_import
  ON candidate_source_connections(candidate_id, platform, import_digest);
`;

export const MIGRATION_20 = `
CREATE TABLE candidate_workspaces (
  candidate_id TEXT PRIMARY KEY REFERENCES candidates(id) ON DELETE CASCADE,
  workspace_cipher TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
`;

/**
 * Removes the platform-authorisation tables, tokens included, from databases
 * created before B163. Dropping a table is the one place the old name has to
 * survive: a database cannot be told to forget something it is not named.
 */
export const MIGRATION_21 = `
DROP TABLE IF EXISTS oauth_authorizations;
DROP TABLE IF EXISTS oauth_connections;
`;

/**
 * B173 — proof of what the candidate accepted and when. The version id names
 * the exact published text, so a later re-issue cannot be mistaken for the one
 * the candidate actually read.
 */
export const MIGRATION_22 = `
CREATE TABLE IF NOT EXISTS legal_consents (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  version_id TEXT NOT NULL,
  documents TEXT NOT NULL,
  accepted_at TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS legal_consents_user ON legal_consents(user_id);
`;

/**
 * B164 — the vacancy pool outlives the process that filled it. Until this
 * migration the pool lived only in memory, so every restart and every deploy
 * served an empty «Возможности» until the scheduler's next run, and the
 * source health report claimed no source had ever been read.
 *
 * Applied by `SqliteVacancyPoolStore` on its own connection, the way
 * `MIGRATION_22` is applied by the auth service: the tables belong to the
 * process that owns the pool, not to every database the store opens.
 */
export const MIGRATION_23 = `
CREATE TABLE IF NOT EXISTS vacancy_pool (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  published_at TEXT NOT NULL,
  stored_at TEXT NOT NULL,
  payload TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS vacancy_pool_source ON vacancy_pool(source_id);

CREATE TABLE IF NOT EXISTS vacancy_source_state (
  source_id TEXT PRIMARY KEY,
  last_sync_at TEXT,
  last_status TEXT,
  last_error_message TEXT,
  items_found_total INTEGER NOT NULL DEFAULT 0,
  items_active_total INTEGER NOT NULL DEFAULT 0,
  observations TEXT
) STRICT;
`;

/**
 * B200 — наблюдения опроса на базах, созданных до B200. `MIGRATION_23`
 * применяется самим хранилищем пула и обязан оставаться идемпотентным, а
 * SQLite не знает `ADD COLUMN IF NOT EXISTS`; поэтому колонка добавляется
 * отдельно, после проверки `PRAGMA table_info`.
 *
 * Без неё живость обнулялась бы каждым деплоем: «пусто три опроса подряд» —
 * наблюдение, которое копится днями, а процесс живёт часы.
 */
export const VACANCY_SOURCE_OBSERVATIONS_COLUMN = `
ALTER TABLE vacancy_source_state ADD COLUMN observations TEXT;
`;

/**
 * B231 — ручная кнопка админки только ставит durable отметку. Обслуживатель
 * подхватывает её из той же SQLite-базы, поэтому HTTP-процесс не ходит к
 * площадке и не пишет пул в режиме `recluster: off`.
 */
export const VACANCY_SOURCE_SYNC_REQUESTED_AT_COLUMN = `
ALTER TABLE vacancy_source_state ADD COLUMN sync_requested_at TEXT;
`;

/** Текущий ручной опрос нужен экрану админки, чтобы не выдавать «готово». */
export const VACANCY_SOURCE_SYNC_STARTED_AT_COLUMN = `
ALTER TABLE vacancy_source_state ADD COLUMN sync_started_at TEXT;
`;

/**
 * Дата смерти объявления (B200 срез 2). Отсутствие записи неотличимо от
 * «никогда не видели», поэтому снятое объявление не удаляется, а помечается.
 */
export const VACANCY_POOL_EXPIRED_AT_COLUMN = `
ALTER TABLE vacancy_pool ADD COLUMN expired_at TEXT;
`;

/**
 * B221 — пул читается из базы, а не из кучи. Узкая таблица рядом с
 * `vacancy_pool`: всё, по чему хранилище отвечает на вопросы движка без
 * разбора `payload` — окно свежести, срез площадки по дате наблюдения (B219),
 * доля активных, флаг удалёнки, ссылка для обхода живости, поисковая строка
 * админки и признак похороненности.
 *
 * ЗАЧЕМ ОТДЕЛЬНАЯ ТАБЛИЦА. Колонка, добавленная в `vacancy_pool` после
 * `payload`, лежит в строке за ним, и любой фильтр по ней читает всю таблицу
 * вместе с текстами: на 100 000 записей это 1,2 ГБ и 7 с на запрос (замер
 * 2026-09-15). Узкая строка читается целиком за десятки миллисекунд, а
 * `payload` берётся точечно только для выбранной страницы.
 *
 * `expired` дублирует `expired_at` основной таблицы по той же причине — та
 * колонка тоже лежит за `payload`. Обе меняются в одной транзакции.
 * Регистр поисковой строки снят на стороне JavaScript: `lower()` SQLite знает
 * только латиницу. Строки, записанные до B221, дочитываются из `payload`
 * фоновым проходом при старте.
 */
/**
 * Вход сведения (B221): проекция записи, которую кластеры читают на самом
 * деле — см. `clusterProjectionOf`. Отдельная таблица, а не колонка индекса:
 * `ALTER TABLE … ADD COLUMN` на STRICT-таблице в 173 000 строк шёл на проде
 * дольше окна проверки здоровья при старте (выкат `d2d1b75` отклонён
 * activate-скриптом), а пустая таблица создаётся мгновенно. Наполняется тем
 * же фоновым дочитыванием, что и индекс; сироты (запись снята) вычищаются
 * при `prune`, читаются они всё равно только через живую строку индекса.
 */
export const VACANCY_CLUSTER_INPUT_TABLE = `
CREATE TABLE IF NOT EXISTS vacancy_cluster_input (
  id TEXT PRIMARY KEY,
  cluster_json TEXT NOT NULL
) STRICT;
`;

export const VACANCY_CLUSTERS_TABLE = `
CREATE TABLE IF NOT EXISTS vacancy_clusters (
  id TEXT PRIMARY KEY,
  fingerprint TEXT NOT NULL,
  title TEXT NOT NULL,
  company TEXT NOT NULL,
  cluster_json TEXT NOT NULL,
  items_count INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS vacancy_clusters_fingerprint ON vacancy_clusters(fingerprint);
CREATE INDEX IF NOT EXISTS vacancy_clusters_freshness ON vacancy_clusters(updated_at DESC, id ASC);
`;

export const VACANCY_POOL_INDEX_TABLE = `
CREATE TABLE IF NOT EXISTS vacancy_pool_index (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  published_ms INTEGER,
  observed_ms INTEGER,
  is_active INTEGER NOT NULL,
  is_remote INTEGER,
  url TEXT NOT NULL,
  search_text TEXT NOT NULL,
  expired INTEGER NOT NULL DEFAULT 0
) STRICT;
CREATE INDEX IF NOT EXISTS vacancy_pool_index_fresh
  ON vacancy_pool_index(published_ms, id) WHERE expired = 0;
CREATE INDEX IF NOT EXISTS vacancy_pool_index_source
  ON vacancy_pool_index(source_id, observed_ms) WHERE expired = 0;
CREATE INDEX IF NOT EXISTS vacancy_pool_index_source_fresh
  ON vacancy_pool_index(source_id, published_ms) WHERE expired = 0;
`;

/**
 * B229 — materialized public catalog. Listing requests must not parse
 * `vacancy_clusters.cluster_json`: the row below contains only the fields
 * needed for a public card and for SQL facets. `cluster_id` points back to the
 * durable cluster for the one-row detail path.
 */
export const VACANCY_CATALOG_ENTRIES_TABLE = `
CREATE TABLE IF NOT EXISTS catalog_entries (
  cluster_id TEXT PRIMARY KEY,
  entry_key TEXT NOT NULL UNIQUE,
  path TEXT NOT NULL,
  title TEXT NOT NULL,
  company TEXT NOT NULL,
  location TEXT,
  is_remote INTEGER NOT NULL CHECK (is_remote IN (0, 1)),
  salary_label TEXT,
  summary TEXT NOT NULL,
  skills_json TEXT NOT NULL,
  source_url TEXT NOT NULL,
  source_name TEXT,
  published_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  source_count INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'archived')),
  place_slug TEXT,
  place_label TEXT,
  role_slug TEXT,
  role_label TEXT,
  published_ms INTEGER NOT NULL,
  last_seen_ms INTEGER NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS catalog_entries_order
  ON catalog_entries(status, published_ms DESC, entry_key ASC);
CREATE INDEX IF NOT EXISTS catalog_entries_place
  ON catalog_entries(status, place_slug, published_ms DESC, entry_key ASC);
CREATE INDEX IF NOT EXISTS catalog_entries_role
  ON catalog_entries(status, role_slug, place_slug, published_ms DESC, entry_key ASC);
CREATE INDEX IF NOT EXISTS catalog_entries_path
  ON catalog_entries(status, path);

CREATE TABLE IF NOT EXISTS catalog_entries_seen (
  cluster_id TEXT PRIMARY KEY,
  processed_at INTEGER NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS catalog_projection_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  cursor_rowid INTEGER NOT NULL DEFAULT 0,
  completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1)),
  updated_at INTEGER NOT NULL
) STRICT;
INSERT OR IGNORE INTO catalog_projection_state (id, cursor_rowid, completed, updated_at)
  VALUES (1, 0, 0, strftime('%s', 'now'));
`;

/**
 * B180 срез 2 — выбранная роль как версионированный объект «Стратегия».
 *
 * Одна строка на кандидата: текущая версия и вся история решений лежат в одном
 * запечатанном значении. Версии мало и они маленькие, а порядок между ними
 * важнее, чем возможность искать по ним запросом.
 */
export const MIGRATION_24 = `
CREATE TABLE career_strategies (
  candidate_id TEXT PRIMARY KEY REFERENCES candidates(id) ON DELETE CASCADE,
  strategy_cipher TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
`;

/**
 * B180 срез 3 — ответы на задания «Какие роли мне подходят».
 *
 * Версия ключа лежит в строке рядом с ответами: формулировки заданий
 * версионируются вместе с ключом, и результат, посчитанный по прежним словам,
 * нельзя молча выдавать за результат по новым.
 */
export const MIGRATION_25 = `
CREATE TABLE work_preference_runs (
  candidate_id TEXT PRIMARY KEY REFERENCES candidates(id) ON DELETE CASCADE,
  key_version TEXT NOT NULL,
  run_cipher TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
`;

/**
 * B187 — прежний «ассесмент» `work-preferences-v1` удаляется целиком.
 *
 * Его метод (шкала 1..5, веса семейств и сводный балл `signalStrength`)
 * запрещён правилами честности продукта (B178, PRB-016) и заменён парным
 * выбором (B180 срез 3). Сохранённые строки удаляются, а не остаются лежать:
 * прочитать их без удалённого движка нельзя, а ответы 1..5 не переносятся в
 * новый ключ. `CHECK` в SQLite не сужается на месте, поэтому таблица
 * пересоздаётся; строки `product-case-v1` переносятся как есть.
 */
export const MIGRATION_26 = `
CREATE TABLE assessments_product_case_only (
  candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  assessment_id TEXT NOT NULL CHECK (assessment_id = 'product-case-v1'),
  submission_cipher TEXT NOT NULL,
  result_cipher TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (candidate_id, assessment_id)
) STRICT;

INSERT INTO assessments_product_case_only
  (candidate_id, assessment_id, submission_cipher, result_cipher,
   completed_at, updated_at)
SELECT candidate_id, assessment_id, submission_cipher, result_cipher,
       completed_at, updated_at
  FROM assessments
 WHERE assessment_id = 'product-case-v1';

DROP TABLE assessments;

ALTER TABLE assessments_product_case_only RENAME TO assessments;
`;

/**
 * B191 — названные роли переживают рестарт.
 *
 * Кэш называния жил в памяти процесса и терялся при каждом деплое, поэтому
 * каждый рестарт заново звал модель — и упирался в исчерпанную бесплатную
 * квоту Gemini (`429`, INC-035). Ключ — хэш «язык + факты», названия ролей
 * лежат зашифрованными: они выведены из фактов кандидата.
 *
 * Применяется `SqliteRoleNamingCache` на своём соединении — тем же способом,
 * что `MIGRATION_23` применяется хранилищем пула вакансий.
 */
export const MIGRATION_27 = `
CREATE TABLE IF NOT EXISTS role_naming_cache (
  cache_key TEXT PRIMARY KEY,
  named_at TEXT NOT NULL,
  roles_cipher TEXT NOT NULL
) STRICT;
`;

/**
 * B165 срез 1 — ручной отклик кандидата (узлы 5, 6, 8, 9).
 *
 * Одна строка на пару кандидат + запись пула. Снимок вакансии запечатан рядом
 * со статусом: запись выбывает из пула через недели, а отклик и воронка
 * обязаны пережить это выбывание. `opened` и `applied` — разные события, и
 * дата у каждого своя, чтобы «открыл» никогда не считалось откликом.
 */
export const MIGRATION_28 = `
CREATE TABLE vacancy_applications (
  candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  cluster_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('opened', 'applied')),
  vacancy_cipher TEXT NOT NULL,
  opened_at TEXT,
  applied_at TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (candidate_id, cluster_id)
) STRICT;
`;

/**
 * B195 / PRB-014 — политика обещает хранить запись об акцепте «3 года с даты
 * прекращения договора». Даты прекращения не существовало, поэтому и считать
 * было не от чего: строка согласия жила вечно. Колонка ставится при удалении
 * аккаунта; пока она пуста, договор действует и уборка запись не трогает.
 */
export const MIGRATION_29 = `
ALTER TABLE legal_consents ADD COLUMN contract_ended_at TEXT;
`;

/**
 * B214 — настройки веера обхода hh.ru. Одна строка на всю установку.
 *
 * ЗАЧЕМ ТАБЛИЦА, А НЕ КОНСТАНТА. Набор ролей выбирает владелец, а не агент, и
 * выбор обязан пережить выкат. Отметка последнего полного прохода лежит рядом
 * по той же причине: без неё каждый перезапуск начинал бы двадцатиминутный
 * глубокий обход заново, и площадка видела бы всплеск на каждый деплой.
 */
export const MIGRATION_30 = `
CREATE TABLE IF NOT EXISTS hh_crawl_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  role_ids TEXT NOT NULL,
  search_period_days INTEGER NOT NULL,
  last_full_sweep_at TEXT,
  updated_at TEXT NOT NULL
) STRICT;
`;

/**
 * B219 — курсор глубокого прохода hh.ru. Одна строка: план прохода и место,
 * до которого он дочитан.
 *
 * ЗАЧЕМ. Глубокий проход идёт часы, а служба перезапускается на каждом
 * выкате: 14.09 — одиннадцать стартов. Без курсора каждый старт начинал
 * проход с нуля, и отметка полного прохода не ставилась ни разу. План лежит
 * здесь же, чтобы после перезапуска не повторять замеры размера частей.
 */
export const MIGRATION_31 = `
CREATE TABLE IF NOT EXISTS hh_crawl_progress (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  phase TEXT NOT NULL,
  role_ids TEXT NOT NULL,
  search_period_days INTEGER NOT NULL,
  plan_json TEXT NOT NULL,
  started_at TEXT NOT NULL,
  role_index INTEGER NOT NULL,
  query_index INTEGER NOT NULL,
  page INTEGER NOT NULL,
  pages_read INTEGER NOT NULL,
  errors INTEGER NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS hh_crawl_plan_cache (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  role_ids TEXT NOT NULL,
  search_period_days INTEGER NOT NULL,
  plan_json TEXT NOT NULL,
  planned_at TEXT NOT NULL
) STRICT;
`;

/**
 * Ключи кластеров для сведения без полной пересборки (B230). Виды — те же,
 * что у `ClusterIndex` в куче, плюс `member` для точечного снятия записи.
 * `cluster_keys_backfill_state` — курсор резюмируемого заполнения по
 * существующим кластерам, по образцу `catalog_projection_state`.
 */
export const VACANCY_CLUSTER_KEYS_TABLE = `
CREATE TABLE IF NOT EXISTS vacancy_cluster_keys (
  kind TEXT NOT NULL,
  key TEXT NOT NULL,
  cluster_id TEXT NOT NULL,
  PRIMARY KEY (kind, key, cluster_id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS vacancy_cluster_keys_by_cluster
  ON vacancy_cluster_keys(cluster_id, kind, key);
CREATE TABLE IF NOT EXISTS cluster_keys_backfill_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  cursor_rowid INTEGER NOT NULL DEFAULT 0,
  completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1)),
  updated_at INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO cluster_keys_backfill_state (id) VALUES (1);
`;

/** Представитель кластера для сравнения без чтения `cluster_json` (B230). */
export const VACANCY_CLUSTER_REPRESENTATIVE_COLUMN = `
ALTER TABLE vacancy_clusters ADD COLUMN representative TEXT;
`;

/**
 * Кешированные байты фото/логотипа из LinkedIn (B265 §4, §5). Только
 * `CREATE TABLE IF NOT EXISTS` — окно здоровья выката 20 с не переживает
 * `ALTER TABLE` на проде (B230), а создание пустой таблицы не читает
 * существующие страницы. `media_id` считается без query-строки ссылки, поэтому
 * один и тот же логотип трёх должностей хранится одной строкой.
 */
export const MIGRATION_32 = `
CREATE TABLE IF NOT EXISTS candidate_media (
  candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  media_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('photo', 'employer_logo')),
  mime TEXT NOT NULL,
  bytes_cipher TEXT NOT NULL,
  byte_length INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (candidate_id, media_id)
) STRICT;
`;

// B251 срез 1 — модель трекера откликов. Вынесена в `applicationTrackerSchema.ts`,
// чтобы держать этот файл под гейтом 800 строк; см. подробности там.
export { MIGRATION_33 } from './applicationTrackerSchema';

/**
 * B266 — a candidate asks for a paid plan before payment is wired. One row per
 * candidate and plan; a new small table, no change to existing ones, so it
 * adds nothing to the deploy health window.
 */
export const MIGRATION_34 = `
CREATE TABLE IF NOT EXISTS plan_requests (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(candidate_id, plan_id)
) STRICT;
`;
