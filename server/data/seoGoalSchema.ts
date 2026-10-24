/** Internal operational metadata only; never forwarded to browser analytics. */
export const SEO_GOAL_MIGRATION = `
CREATE TABLE candidate_goal_markers (
  candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('onboarding_completed', 'application_receipt')),
  entity_key TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  evidence_kind TEXT NOT NULL CHECK (evidence_kind IN ('wizard_completion', 'confirmation_url', 'auto_reply', 'screenshot')),
  provenance TEXT NOT NULL CHECK (provenance IN ('candidate')),
  PRIMARY KEY (candidate_id, kind, entity_key)
) STRICT;
CREATE INDEX candidate_goal_markers_recorded ON candidate_goal_markers(recorded_at, kind);
`;
