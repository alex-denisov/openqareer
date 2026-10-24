import type { DatabaseSync } from 'node:sqlite';
import type { SeoGoalSummary } from '../../shared/seoSummary';

export function recordCandidateGoal(
  database: DatabaseSync,
  candidateId: string,
  kind: 'onboarding_completed' | 'application_receipt',
  entityKey: string,
  evidenceKind: 'wizard_completion' | 'confirmation_url' | 'auto_reply' | 'screenshot',
  recordedAt: string,
): void {
  database.prepare(`INSERT INTO candidate_goal_markers
    (candidate_id, kind, entity_key, recorded_at, evidence_kind, provenance)
    VALUES (?, ?, ?, ?, ?, 'candidate')
    ON CONFLICT(candidate_id, kind, entity_key) DO NOTHING`)
    .run(candidateId, kind, entityKey, recordedAt, evidenceKind);
}

export function readSeoGoalSummary(database: DatabaseSync, days = 28, now = new Date()): SeoGoalSummary {
  if (!Number.isInteger(days) || days < 1 || days > 90) throw new RangeError('invalid_summary_period');
  const to = now.toISOString();
  const from = new Date(now.getTime() - days * 86_400_000).toISOString();
  const hasTable = (table: string) => Boolean(database.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
  ).get(table));
  const excludeTestAccounts = hasTable('users')
    ? 'AND NOT EXISTS (SELECT 1 FROM users AS u WHERE u.candidate_id = c.id AND u.is_test = 1)'
    : '';
  const count = (kind: string) => Number((database.prepare(`SELECT count(*) AS total
    FROM candidate_goal_markers AS goals JOIN candidates AS c ON c.id = goals.candidate_id
    WHERE c.data_class = 'personal' ${excludeTestAccounts} AND goals.kind = ? AND goals.recorded_at >= ? AND goals.recorded_at < ?`)
    .get(kind, from, to) as { total: number }).total);
  // Candidate-only standalone stores may have no auth/billing schema. Missing is not zero.
  const trials = hasTable('billing_pro_trials') && hasTable('users')
    ? Number((database.prepare(`SELECT count(*) AS total FROM billing_pro_trials AS trial
      JOIN users AS u ON u.id = trial.user_id JOIN candidates AS c ON c.id = u.candidate_id
      WHERE c.data_class = 'personal' AND u.is_test = 0 AND trial.started_at >= ? AND trial.started_at < ?`)
      .get(from, to) as { total: number }).total)
    : null;
  return {
    observedAt: to, period: { from, to, days }, source: 'internal_operational_records',
    goals: { onboardingCompleted: count('onboarding_completed'), proTrialsStarted: trials,
      applicationsWithCandidateReceipt: count('application_receipt') },
    methodology: { onboarding: 'explicit_wizard_completion_since_instrumentation', trials: 'committed_trial_rows',
      applications: 'candidate_provided_positive_receipt_since_instrumentation', deletedCandidates: 'excluded',
      syntheticCandidates: 'excluded', organicConversion: 'unavailable_no_attribution' },
    searchProviders: { google: { status: 'unavailable' }, yandex: { status: 'unavailable' } },
  };
}
