/** B579: события квот тарифа; одна строка — одна списанная единица за период. */
export const MIGRATION_TARIFF_QUOTAS = `
CREATE TABLE IF NOT EXISTS billing_quota_events (
  candidate_id TEXT NOT NULL,
  quota_key TEXT NOT NULL CHECK (quota_key IN (
    'applications', 'auto_applications', 'coach_turns', 'interview_trainings', 'linkedin_drafts'
  )),
  period_started_at TEXT NOT NULL,
  unit_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (candidate_id, quota_key, period_started_at, unit_key)
) STRICT;
`;
