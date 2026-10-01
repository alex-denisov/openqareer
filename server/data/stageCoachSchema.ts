/**
 * B340 срез 1 — раздельные ленты консультанта по этапам и отклонение предложений.
 * Только CREATE TABLE/INDEX IF NOT EXISTS, никаких ALTER TABLE.
 */
export const MIGRATION_36 = `
CREATE TABLE IF NOT EXISTS message_stages (
  message_id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL,
  stage TEXT NOT NULL,
  subject_kind TEXT,
  subject_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_message_stages_candidate_stage ON message_stages(candidate_id, stage);

CREATE TABLE IF NOT EXISTS turn_stages (
  candidate_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  stage TEXT NOT NULL,
  subject_kind TEXT,
  subject_id TEXT,
  is_service INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (candidate_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS consultant_rejections (
  candidate_id TEXT NOT NULL,
  proposal_key TEXT NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (candidate_id, proposal_key)
);
`;
