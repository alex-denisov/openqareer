/**
 * C58 / срез 2 — журнал изменений профиля и откат правок консультанта.
 * Записи создаются только после одобрения кандидатом команды `resume.revise`.
 */
export const MIGRATION_37 = `
CREATE TABLE IF NOT EXISTS profile_revisions (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  command_id TEXT NOT NULL,
  section TEXT NOT NULL CHECK (section IN ('headline', 'about', 'experience')),
  experience_id TEXT,
  previous_text_cipher TEXT NOT NULL,
  applied_text_cipher TEXT NOT NULL,
  created_at TEXT NOT NULL,
  reverted_at TEXT,
  UNIQUE(candidate_id, command_id)
) STRICT;

CREATE INDEX IF NOT EXISTS profile_revisions_candidate ON profile_revisions(candidate_id, created_at);
CREATE INDEX IF NOT EXISTS profile_revisions_command ON profile_revisions(command_id);
`;
