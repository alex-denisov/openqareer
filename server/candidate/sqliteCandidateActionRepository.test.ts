import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { SqliteCandidateActionRepository } from './sqliteCandidateActionRepository';

describe('SqliteCandidateActionRepository', () => {
  it('migrates old receipts to failed-capable status and clears retired action payloads', () => {
    const database = new DatabaseSync(':memory:');
    database.exec(`
      CREATE TABLE candidate_action_receipts (
        id TEXT PRIMARY KEY,
        batch_id TEXT NOT NULL,
        candidate_id TEXT NOT NULL,
        platform TEXT NOT NULL CHECK (platform IN ('hh', 'linkedin')),
        action_kind TEXT NOT NULL CHECK (action_kind IN ('hh_apply', 'hh_resume_boost', 'linkedin_easy_apply')),
        status TEXT NOT NULL CHECK (status IN ('delivered', 'attempted')),
        application_id TEXT,
        target_url TEXT NOT NULL,
        confirmation_url TEXT,
        snapshot_hash TEXT,
        letter_version TEXT,
        letter_cipher TEXT,
        resume_version TEXT,
        resume_id TEXT,
        failure_code TEXT,
        executed_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;
      INSERT INTO candidate_action_receipts VALUES (
        'old-1', 'batch-1', 'candidate-1', 'hh', 'hh_apply', 'delivered', 'app-1',
        'https://hh.ru/vacancy/123', 'https://hh.ru/applicant/responses/1', NULL,
        'v1', 'plaintext letter', NULL, 'resume-1', 'https://hh.ru/vacancy/123?email=a@example.com',
        '2026-10-01T12:00:00.000Z', '2026-10-01T12:00:00.000Z'
      );
    `);

    const repository = new SqliteCandidateActionRepository(database);
    const receipts = repository.listReceipts('candidate-1', 10);
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({
      id: 'old-1',
      status: 'delivered',
      failureCode: 'legacy_failure',
    });
    expect(receipts[0]).not.toHaveProperty('targetUrl');
    expect(receipts[0]).not.toHaveProperty('letterText');
    expect(
      database
        .prepare(
          'SELECT target_url, confirmation_url, letter_cipher, resume_id FROM candidate_action_receipts',
        )
        .get(),
    ).toEqual({ target_url: '', confirmation_url: null, letter_cipher: null, resume_id: null });

    const failed = repository.recordReceipt({
      id: 'failed-1',
      batchId: 'batch-2',
      candidateId: 'candidate-1',
      platform: 'linkedin',
      actionKind: 'linkedin_easy_apply',
      status: 'failed',
      failureCode: 'challenge_required',
      executedAt: '2026-10-01T12:01:00.000Z',
    });
    expect(failed.status).toBe('failed');
  });
});

describe('candidate LinkedIn safety stop status', () => {
  it('reports a candidate-scoped stop reason without returning its storage scope', () => {
    const repository = new SqliteCandidateActionRepository(new DatabaseSync(':memory:'));
    repository.setKillSwitch('candidate:cand-1:linkedin', true, 'challenge_required');

    expect(repository.getLinkedinSafetyStopStatus('cand-1')).toMatchObject({
      paused: true,
      reason: 'challenge_required',
      canResume: true,
    });
    expect(JSON.stringify(repository.getLinkedinSafetyStopStatus('cand-1'))).not.toContain(
      'cand-1',
    );
    expect(repository.getLinkedinSafetyStopStatus('cand-2')).toMatchObject({
      paused: false,
      reason: null,
    });
  });

  it('does not disclose a global pause reason or allow a candidate to resume it', () => {
    const repository = new SqliteCandidateActionRepository(new DatabaseSync(':memory:'));
    repository.setKillSwitch('platform:linkedin', true, 'private-operator-note');

    expect(repository.getLinkedinSafetyStopStatus('cand-1')).toMatchObject({
      paused: true,
      reason: 'platform_pause',
      canResume: false,
    });
    expect(JSON.stringify(repository.getLinkedinSafetyStopStatus('cand-1'))).not.toContain(
      'private-operator-note',
    );
  });

  it('includes the platform-specific candidate scope when enforcing a stop', () => {
    const repository = new SqliteCandidateActionRepository(new DatabaseSync(':memory:'));
    repository.setKillSwitch('candidate:cand-1:linkedin', true, 'challenge_required');

    expect(repository.isKillSwitchActive('linkedin', 'cand-1')).toBe(true);
    expect(repository.isKillSwitchActive('hh', 'cand-1')).toBe(false);
  });
});
