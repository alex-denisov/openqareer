/** Notification rows contain source references and state only; no event text or candidate content is copied. */
export const MIGRATION_43 = `
CREATE TABLE IF NOT EXISTS candidate_notifications (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  event_kind TEXT NOT NULL CHECK (event_kind IN (
    'email_approval', 'post_approval', 'interview_reminder', 'new_vacancies_by_role',
    'employer_opened_letter', 'consultant_edits', 'footprint_findings', 'import_completed',
    'employer_reply', 'delivery_error'
  )),
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  read_at TEXT,
  UNIQUE (candidate_id, idempotency_key)
) STRICT;

CREATE INDEX IF NOT EXISTS candidate_notifications_page
  ON candidate_notifications(candidate_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS candidate_notifications_unread
  ON candidate_notifications(candidate_id, read_at, expires_at);
CREATE INDEX IF NOT EXISTS candidate_notifications_expiry
  ON candidate_notifications(expires_at);

CREATE TABLE IF NOT EXISTS candidate_notification_preferences (
  candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  preference_key TEXT NOT NULL CHECK (preference_key IN (
    'ev-reply', 'ev-reminder', 'ev-approval', 'ev-delivery-error',
    'ev-target-company', 'ev-weekly-digest'
  )),
  app_enabled INTEGER NOT NULL CHECK (app_enabled IN (0, 1)),
  email_enabled INTEGER NOT NULL CHECK (email_enabled IN (0, 1)),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (candidate_id, preference_key)
) STRICT;
`;
