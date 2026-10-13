/** Fixed B398 cutover from the S09 start; older users remain confirmed. */
export const EMAIL_VERIFICATION_CUTOVER_AT = '2026-10-06T15:50:00.000Z';

/** B398: create only a small new table; never alter the 3.8 GB users table. */
export const MIGRATION_39 = `
CREATE TABLE IF NOT EXISTS email_verifications (
  candidate_id TEXT PRIMARY KEY REFERENCES candidates(id) ON DELETE CASCADE,
  code_hash TEXT,
  expires_at TEXT,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  last_sent_at TEXT,
  verified_at TEXT
) STRICT;
`;

/** S10-VIS-2 — a verified address stays active until the replacement is confirmed. */
export const MIGRATION_40 = `
CREATE TABLE IF NOT EXISTS account_email_change_requests (
  candidate_id TEXT PRIMARY KEY REFERENCES candidates(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  current_email TEXT,
  new_email TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  last_sent_at TEXT NOT NULL
) STRICT;
`;
