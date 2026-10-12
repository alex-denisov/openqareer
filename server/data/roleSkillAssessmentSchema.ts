/** B461: candidate-scoped encrypted role assessment progress and results. */
export const MIGRATION_47 = `
CREATE TABLE IF NOT EXISTS role_skill_assessment_runs (
  candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  run_cipher TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (candidate_id, run_id)
) STRICT;

CREATE INDEX IF NOT EXISTS role_skill_assessment_runs_by_candidate
  ON role_skill_assessment_runs(candidate_id, updated_at DESC);
`;
