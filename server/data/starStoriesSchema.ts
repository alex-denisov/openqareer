/** B466: one encrypted, reusable STAR story per candidate-owned id. */
export const MIGRATION_48 = `
CREATE TABLE IF NOT EXISTS candidate_star_stories (
  id TEXT NOT NULL,
  candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  body_cipher TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (candidate_id, id)
) STRICT;
CREATE INDEX IF NOT EXISTS idx_candidate_star_stories_updated
  ON candidate_star_stories(candidate_id, updated_at DESC, id);
`;

export function starStoryAssociatedData(candidateId: string, storyId: string): string {
  return `candidate:${candidateId}:star-story:${storyId}`;
}
