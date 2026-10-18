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


export const PROFILE_REVISION_EXPERIENCE_LINKS_MIGRATION = `
CREATE TABLE IF NOT EXISTS profile_revision_experience_links (
  revision_id TEXT PRIMARY KEY REFERENCES profile_revisions(id) ON DELETE CASCADE,
  candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  previous_chronology_memory_id TEXT NOT NULL,
  applied_chronology_memory_id TEXT NOT NULL,
  CHECK (previous_chronology_memory_id <> applied_chronology_memory_id)
) STRICT;

CREATE INDEX IF NOT EXISTS profile_revision_experience_links_candidate
  ON profile_revision_experience_links(candidate_id, revision_id);
`;
