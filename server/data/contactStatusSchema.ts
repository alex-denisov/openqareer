/** B697: статус «писали / ответили» контактов кандидата; новая таблица, существующие не меняются. */
export const CANDIDATE_CONTACT_STATUS_TABLE = `
CREATE TABLE IF NOT EXISTS candidate_contact_status (
  candidate_id TEXT NOT NULL,
  contact_id TEXT NOT NULL,
  state TEXT NOT NULL,
  at TEXT NOT NULL,
  PRIMARY KEY (candidate_id, contact_id)
) STRICT;
`;
