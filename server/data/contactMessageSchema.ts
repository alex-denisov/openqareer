/** B698: сообщения знакомым и рекрутёрам; новая таблица, существующие не меняются. */
export const CANDIDATE_CONTACT_MESSAGES_TABLE = `
CREATE TABLE IF NOT EXISTS candidate_contact_messages (
  id TEXT NOT NULL PRIMARY KEY,
  candidate_id TEXT NOT NULL,
  contact_id TEXT,
  recruiter_id TEXT,
  vacancy_id TEXT,
  kind TEXT NOT NULL,
  text TEXT NOT NULL,
  recipient_name TEXT NOT NULL,
  recipient_url TEXT,
  state TEXT NOT NULL,
  created_at TEXT NOT NULL,
  approved_at TEXT,
  sent_at TEXT
) STRICT;
CREATE INDEX IF NOT EXISTS candidate_contact_messages_by_contact
  ON candidate_contact_messages(candidate_id, contact_id, created_at);
`;
