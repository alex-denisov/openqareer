/** Идемпотентная схема анкеты релокации и отдельной истории её согласия. */
export const RELOCATION_QUESTIONNAIRE_SCHEMA = `
CREATE TABLE IF NOT EXISTS relocation_questionnaire_consents (
  id INTEGER PRIMARY KEY,
  candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  version_id TEXT NOT NULL,
  granted_at TEXT NOT NULL,
  revoked_at TEXT
) STRICT;
CREATE UNIQUE INDEX IF NOT EXISTS relocation_questionnaire_one_active_consent
  ON relocation_questionnaire_consents (candidate_id) WHERE revoked_at IS NULL;
CREATE TABLE IF NOT EXISTS relocation_questionnaire_profiles (
  candidate_id TEXT PRIMARY KEY REFERENCES candidates(id) ON DELETE CASCADE,
  profile_cipher TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  updated_at TEXT NOT NULL
) STRICT;
`;
