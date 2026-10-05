import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { SqliteCandidateActionRepository } from './sqliteCandidateActionRepository';

describe('candidate LinkedIn safety stop status', () => {
  it('reports a candidate-scoped stop reason without returning its storage scope', () => {
    const repository = new SqliteCandidateActionRepository(new DatabaseSync(':memory:'));
    repository.setKillSwitch('candidate:cand-1:linkedin', true, 'challenge_required');

    expect(repository.getLinkedinSafetyStopStatus('cand-1')).toMatchObject({
      paused: true,
      reason: 'challenge_required',
      canResume: true,
    });
    expect(JSON.stringify(repository.getLinkedinSafetyStopStatus('cand-1'))).not.toContain('cand-1');
    expect(repository.getLinkedinSafetyStopStatus('cand-2')).toMatchObject({ paused: false, reason: null });
  });

  it('does not disclose a global pause reason or allow a candidate to resume it', () => {
    const repository = new SqliteCandidateActionRepository(new DatabaseSync(':memory:'));
    repository.setKillSwitch('platform:linkedin', true, 'private-operator-note');

    expect(repository.getLinkedinSafetyStopStatus('cand-1')).toMatchObject({
      paused: true,
      reason: 'platform_pause',
      canResume: false,
    });
    expect(JSON.stringify(repository.getLinkedinSafetyStopStatus('cand-1'))).not.toContain('private-operator-note');
  });

  it('includes the platform-specific candidate scope when enforcing a stop', () => {
    const repository = new SqliteCandidateActionRepository(new DatabaseSync(':memory:'));
    repository.setKillSwitch('candidate:cand-1:linkedin', true, 'challenge_required');

    expect(repository.isKillSwitchActive('linkedin', 'cand-1')).toBe(true);
    expect(repository.isKillSwitchActive('hh', 'cand-1')).toBe(false);
  });
});
