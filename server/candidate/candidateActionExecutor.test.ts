import { describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import {
  CandidateActionExecutor,
  CandidateActionLimitError,
  CandidateActionTargetError,
  type CandidateActionSessionResolver,
  type CandidateApplicationTracker,
  CandidateConfirmationRequiredError,
  CandidateConsentRequiredError,
  CandidateRunnerNotConnectedError,
  SimulatedCandidatePlatformRunner,
  type RunnerOutcome,
} from './candidateActionExecutor';
import { SqliteCandidateActionRepository } from './sqliteCandidateActionRepository';
import { SqliteCapabilityConsentStore } from '../auth/capabilityConsentStore';

function sessionResolver(): CandidateActionSessionResolver {
  return {
    resolve: async (candidateId, platform) => ({ candidateId, platform, page: {} as never }),
  };
}

function grantActionConsent(
  db: DatabaseSync,
  candidateId = 'cand-1',
): SqliteCapabilityConsentStore {
  const store = new SqliteCapabilityConsentStore(db);
  store.recordConsent({
    userId: candidateId,
    capability: 'actions_on_behalf',
    versionId: 'actions_on_behalf-v1.0',
  });
  return store;
}

const daytime = '2026-10-01T12:00:00Z';

describe('CandidateActionExecutor', () => {
  it('refuses a batch and records nothing when no real platform runner is connected', async () => {
    const db = new DatabaseSync(':memory:');
    const repo = new SqliteCandidateActionRepository(db);
    const executor = new CandidateActionExecutor({
      repository: repo,
      consentStore: grantActionConsent(db),
    });

    await expect(
      executor.executeBatch({
        candidateId: 'cand-1',
        confirmedByCandidate: true,
        actions: [
          { platform: 'hh', actionKind: 'hh_apply', targetUrl: 'https://hh.ru/vacancy/123' },
        ],
      }),
    ).rejects.toThrow(CandidateRunnerNotConnectedError);
    expect(repo.listReceipts('cand-1', 10)).toHaveLength(0);
  });

  it('rejects non-allowlisted action targets before resolving or running a session', async () => {
    const db = new DatabaseSync(':memory:');
    const repo = new SqliteCandidateActionRepository(db);
    const consentStore = grantActionConsent(db);
    const resolve = vi.fn(sessionResolver().resolve);
    const run = vi.fn(async (): Promise<RunnerOutcome> => ({
      status: 'delivered',
      confirmationUrl: 'https://hh.ru/applicant/responses/1',
    }));
    const executor = new CandidateActionExecutor({
      repository: repo,
      runner: { run },
      sessionResolver: { resolve },
      consentStore,
    });

    await expect(
      executor.executeBatch({
        candidateId: 'cand-1',
        confirmedByCandidate: true,
        actions: [
          { platform: 'hh', actionKind: 'hh_apply', targetUrl: 'https://evil.example/vacancy/123' },
        ],
      }),
    ).rejects.toThrow(CandidateActionTargetError);
    expect(resolve).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
    expect(repo.listReceipts('cand-1', 10)).toHaveLength(0);
  });

  it('never records delivered without provider confirmation evidence', async () => {
    const db = new DatabaseSync(':memory:');
    const repo = new SqliteCandidateActionRepository(db);
    const run = vi.fn(async (): Promise<RunnerOutcome> => ({ status: 'delivered' }));
    const executor = new CandidateActionExecutor({
      repository: repo,
      runner: { run },
      sessionResolver: sessionResolver(),
      consentStore: grantActionConsent(db),
      pause: async () => undefined,
    });

    const result = await executor.executeBatch({
      candidateId: 'cand-1',
      confirmedByCandidate: true,
      nowIso: daytime,
      actions: [{ platform: 'hh', actionKind: 'hh_apply', targetUrl: 'https://hh.ru/vacancy/123' }],
    });

    expect(result.receipts[0]?.status).toBe('failed');
    expect(result.receipts[0]?.failureCode).toBe('provider_confirmation_missing');
    expect(repo.getDailyUsage('cand-1', '2026-10-01').hhAppliesCount).toBe(1);
  });

  it('stops after a platform challenge and records no later attempt', async () => {
    const db = new DatabaseSync(':memory:');
    const repo = new SqliteCandidateActionRepository(db);
    const attemptedTargets: string[] = [];
    const runner = {
      async run(action: { targetUrl: string }): Promise<RunnerOutcome> {
        attemptedTargets.push(action.targetUrl);
        return { status: 'failed', failureCode: 'challenge_required' };
      },
    };
    const executor = new CandidateActionExecutor({
      repository: repo,
      runner,
      sessionResolver: sessionResolver(),
      consentStore: grantActionConsent(db),
      pause: async () => undefined,
    });

    const result = await executor.executeBatch({
      candidateId: 'cand-1',
      confirmedByCandidate: true,
      nowIso: daytime,
      actions: [
        { platform: 'hh', actionKind: 'hh_apply', targetUrl: 'https://hh.ru/vacancy/1' },
        { platform: 'hh', actionKind: 'hh_apply', targetUrl: 'https://hh.ru/vacancy/2' },
      ],
    });

    expect(attemptedTargets).toEqual(['https://hh.ru/vacancy/1']);
    expect(result.receipts.map((receipt) => receipt.status)).toEqual(['failed', 'failed']);
    expect(result.receipts[0]?.failureCode).toBe('challenge_required');
    expect(result.receipts[1]?.failureCode).toBe('batch_stopped');
  });

  it('rejects execution when confirmedByCandidate is false', async () => {
    const db = new DatabaseSync(':memory:');
    const repo = new SqliteCandidateActionRepository(db);
    const executor = new CandidateActionExecutor({
      repository: repo,
      runner: new SimulatedCandidatePlatformRunner(),
      sessionResolver: sessionResolver(),
      consentStore: grantActionConsent(db),
    });

    await expect(
      executor.executeBatch({
        candidateId: 'cand-1',
        confirmedByCandidate: false,
        actions: [
          { platform: 'hh', actionKind: 'hh_apply', targetUrl: 'https://hh.ru/vacancy/123' },
        ],
      }),
    ).rejects.toThrow(CandidateConfirmationRequiredError);
  });

  it('rejects execution when actions_on_behalf consent is missing', async () => {
    const db = new DatabaseSync(':memory:');
    const executor = new CandidateActionExecutor({
      repository: new SqliteCandidateActionRepository(db),
      runner: new SimulatedCandidatePlatformRunner(),
      sessionResolver: sessionResolver(),
      consentStore: new SqliteCapabilityConsentStore(db),
    });

    await expect(
      executor.executeBatch({
        candidateId: 'cand-1',
        confirmedByCandidate: true,
        actions: [
          { platform: 'hh', actionKind: 'hh_apply', targetUrl: 'https://hh.ru/vacancy/123' },
        ],
      }),
    ).rejects.toThrow(CandidateConsentRequiredError);
  });

  it('executes a confirmed and consented batch and retains only status metadata', async () => {
    const db = new DatabaseSync(':memory:');
    const repo = new SqliteCandidateActionRepository(db);
    const executor = new CandidateActionExecutor({
      repository: repo,
      runner: new SimulatedCandidatePlatformRunner(),
      sessionResolver: sessionResolver(),
      consentStore: grantActionConsent(db),
      pause: async () => undefined,
    });

    const result = await executor.executeBatch({
      candidateId: 'cand-1',
      confirmedByCandidate: true,
      nowIso: daytime,
      actions: [
        {
          platform: 'hh',
          actionKind: 'hh_apply',
          applicationId: 'app-1',
          targetUrl: 'https://hh.ru/vacancy/123',
          letterText: 'Сопроводительное письмо',
        },
      ],
    });

    expect(result.status).toBe('completed');
    expect(result.receipts[0]?.status).toBe('delivered');
    expect(result.receipts[0]).not.toHaveProperty('targetUrl');
    expect(result.receipts[0]).not.toHaveProperty('letterText');
    const stored = db
      .prepare('SELECT target_url, letter_cipher, confirmation_url FROM candidate_action_receipts')
      .get();
    expect(stored).toEqual({ target_url: '', letter_cipher: null, confirmation_url: null });
    expect(repo.getDailyUsage('cand-1', '2026-10-01').hhAppliesCount).toBe(1);
  });

  it('stops before a platform action when the kill switch is already active', async () => {
    const db = new DatabaseSync(':memory:');
    const repo = new SqliteCandidateActionRepository(db);
    repo.setKillSwitch('platform:hh', true, 'maintenance');
    const run = vi.fn(async (): Promise<RunnerOutcome> => ({
      status: 'delivered',
      providerStatus: 'hh_response_submitted',
    }));
    const executor = new CandidateActionExecutor({
      repository: repo,
      runner: { run },
      sessionResolver: sessionResolver(),
      consentStore: grantActionConsent(db),
    });

    const result = await executor.executeBatch({
      candidateId: 'cand-1',
      confirmedByCandidate: true,
      nowIso: daytime,
      actions: [{ platform: 'hh', actionKind: 'hh_apply', targetUrl: 'https://hh.ru/vacancy/123' }],
    });

    expect(result.status).toBe('aborted');
    expect(result.receipts[0]?.status).toBe('failed');
    expect(result.receipts[0]?.failureCode).toBe('kill_switch_active');
    expect(run).not.toHaveBeenCalled();
    expect(repo.getDailyUsage('cand-1', '2026-10-01').hhAppliesCount).toBe(0);
  });

  it('checks the kill switch again after every action before continuing', async () => {
    const db = new DatabaseSync(':memory:');
    const repo = new SqliteCandidateActionRepository(db);
    let calls = 0;
    const runner = {
      async run(): Promise<RunnerOutcome> {
        calls += 1;
        repo.setKillSwitch('candidate:cand-1', true, 'candidate requested stop');
        return { status: 'delivered', providerStatus: 'hh_response_submitted' };
      },
    };
    const executor = new CandidateActionExecutor({
      repository: repo,
      runner,
      sessionResolver: sessionResolver(),
      consentStore: grantActionConsent(db),
      pause: async () => undefined,
    });

    const result = await executor.executeBatch({
      candidateId: 'cand-1',
      confirmedByCandidate: true,
      nowIso: daytime,
      actions: [
        { platform: 'hh', actionKind: 'hh_apply', targetUrl: 'https://hh.ru/vacancy/1' },
        { platform: 'hh', actionKind: 'hh_apply', targetUrl: 'https://hh.ru/vacancy/2' },
      ],
    });

    expect(calls).toBe(1);
    expect(result.receipts.map((receipt) => receipt.status)).toEqual(['delivered', 'failed']);
    expect(result.receipts[1]?.failureCode).toBe('kill_switch_active');
  });

  it('writes pending receipts before the runner starts so the panel can show progress', async () => {
    const db = new DatabaseSync(':memory:');
    const repo = new SqliteCandidateActionRepository(db);
    let release!: () => void;
    const runner = {
      async run(): Promise<RunnerOutcome> {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return { status: 'delivered', providerStatus: 'hh_response_submitted' };
      },
    };
    const executor = new CandidateActionExecutor({
      repository: repo,
      runner,
      sessionResolver: sessionResolver(),
      consentStore: grantActionConsent(db),
    });

    const running = executor.executeBatch({
      candidateId: 'cand-1',
      confirmedByCandidate: true,
      batchId: '00000000-0000-4000-8000-000000000010',
      nowIso: daytime,
      actions: [{ platform: 'hh', actionKind: 'hh_apply', targetUrl: 'https://hh.ru/vacancy/123' }],
    });
    await vi.waitFor(() =>
      expect(
        repo.listReceipts('cand-1', 10, '00000000-0000-4000-8000-000000000010')[0]?.status,
      ).toBe('pending'),
    );
    release();
    await expect(running).resolves.toMatchObject({ status: 'completed' });
  });

  it('uses a randomized 3 to 30 second pause between actions', async () => {
    const db = new DatabaseSync(':memory:');
    const repo = new SqliteCandidateActionRepository(db);
    const waits: number[] = [];
    const executor = new CandidateActionExecutor({
      repository: repo,
      runner: new SimulatedCandidatePlatformRunner(),
      sessionResolver: sessionResolver(),
      consentStore: grantActionConsent(db),
      random: () => 0.5,
      pause: async (milliseconds) => {
        waits.push(milliseconds);
      },
    });

    await executor.executeBatch({
      candidateId: 'cand-1',
      confirmedByCandidate: true,
      nowIso: daytime,
      actions: [
        { platform: 'hh', actionKind: 'hh_apply', targetUrl: 'https://hh.ru/vacancy/1' },
        { platform: 'hh', actionKind: 'hh_apply', targetUrl: 'https://hh.ru/vacancy/2' },
      ],
    });

    expect(waits).toHaveLength(1);
    expect(waits[0]).toBeGreaterThanOrEqual(3_000);
    expect(waits[0]).toBeLessThanOrEqual(30_000);
  });

  it('blocks quiet hours and packages that exceed the remaining daily allowance before execution', async () => {
    const db = new DatabaseSync(':memory:');
    const repo = new SqliteCandidateActionRepository(db);
    const run = vi.fn(async (): Promise<RunnerOutcome> => ({
      status: 'delivered',
      providerStatus: 'hh_response_submitted',
    }));
    const executor = new CandidateActionExecutor({
      repository: repo,
      runner: { run },
      sessionResolver: sessionResolver(),
      consentStore: grantActionConsent(db),
    });

    await expect(
      executor.executeBatch({
        candidateId: 'cand-1',
        confirmedByCandidate: true,
        nowIso: '2026-10-01T01:00:00Z',
        clientTimezone: 'Europe/Moscow',
        actions: [{ platform: 'hh', actionKind: 'hh_apply', targetUrl: 'https://hh.ru/vacancy/1' }],
      }),
    ).rejects.toThrow(CandidateActionLimitError);
    repo.recordActionUsage('cand-1', '2026-10-01', 'hh_apply', daytime);
    await expect(
      executor.executeBatch({
        candidateId: 'cand-1',
        confirmedByCandidate: true,
        nowIso: daytime,
        actions: Array.from({ length: 15 }, (_, index) => ({
          platform: 'hh' as const,
          actionKind: 'hh_apply' as const,
          targetUrl: `https://hh.ru/vacancy/${index + 1}`,
        })),
      }),
    ).rejects.toThrow(CandidateActionLimitError);
    expect(run).not.toHaveBeenCalled();
  });

  it('moves a card with the current expectedVersion only after a confirmed delivery', async () => {
    const db = new DatabaseSync(':memory:');
    const repo = new SqliteCandidateActionRepository(db);
    const stages: Record<string, string> = { 'app-1': 'saved', 'app-2': 'saved' };
    const patches: Array<{ applicationId: string; expectedVersion: number; stage?: string }> = [];
    const tracker: CandidateApplicationTracker = {
      getApplication: (_candidateId, applicationId) => ({
        version: 7,
        stage: stages[applicationId] ?? 'saved',
      }),
      patchApplication: (_candidateId, applicationId, patch) => {
        patches.push({ applicationId, ...patch });
        if (patch.stage) stages[applicationId] = patch.stage;
      },
      recordApplicationEvent: () => undefined,
    };
    const runner = {
      async run(action: { applicationId?: string | null }): Promise<RunnerOutcome> {
        return action.applicationId === 'app-1'
          ? { status: 'delivered', providerStatus: 'hh_response_submitted' }
          : { status: 'failed', failureCode: 'session_expired' };
      },
    };
    const executor = new CandidateActionExecutor({
      repository: repo,
      runner,
      sessionResolver: sessionResolver(),
      consentStore: grantActionConsent(db),
      applicationTracker: tracker,
      pause: async () => undefined,
    });

    const result = await executor.executeBatch({
      candidateId: 'cand-1',
      confirmedByCandidate: true,
      nowIso: daytime,
      actions: [
        {
          platform: 'hh',
          actionKind: 'hh_apply',
          applicationId: 'app-1',
          targetUrl: 'https://hh.ru/vacancy/1',
        },
        {
          platform: 'hh',
          actionKind: 'hh_apply',
          applicationId: 'app-2',
          targetUrl: 'https://hh.ru/vacancy/2',
        },
      ],
    });

    expect(result.status).toBe('partial_failure');
    expect(stages['app-1']).toBe('applied');
    expect(stages['app-2']).toBe('saved');
    expect(patches).toEqual([
      {
        applicationId: 'app-1',
        expectedVersion: 7,
        stage: 'applied',
        occurredAt: '2026-10-01T12:00:00.000Z',
      },
    ]);
  });

  it('pauses only this candidate’s LinkedIn actions on a platform restriction and stops the batch', async () => {
    const db = new DatabaseSync(':memory:');
    const repo = new SqliteCandidateActionRepository(db);
    const calls: string[] = [];
    const runner = {
      async run(action: { targetUrl: string }): Promise<RunnerOutcome> {
        calls.push(action.targetUrl);
        return { status: 'attempted', failureCode: 'http_429' };
      },
    };
    const executor = new CandidateActionExecutor({
      repository: repo,
      runner,
      sessionResolver: sessionResolver(),
      consentStore: grantActionConsent(db),
      pause: async () => undefined,
    });

    const result = await executor.executeBatch({
      candidateId: 'cand-1',
      confirmedByCandidate: true,
      nowIso: daytime,
      actions: [
        {
          platform: 'linkedin',
          actionKind: 'linkedin_easy_apply',
          targetUrl: 'https://www.linkedin.com/jobs/view/1',
        },
        {
          platform: 'linkedin',
          actionKind: 'linkedin_easy_apply',
          targetUrl: 'https://www.linkedin.com/jobs/view/2',
        },
      ],
    });

    expect(calls).toEqual(['https://www.linkedin.com/jobs/view/1']);
    expect(result.receipts).toHaveLength(2);
    expect(result.receipts[1]?.failureCode).toBe('batch_stopped');
    expect(repo.getLinkedinSafetyStopStatus('cand-1')).toMatchObject({
      paused: true,
      reason: 'platform_restricted',
      canResume: true,
    });
    expect(repo.getLinkedinSafetyStopStatus('cand-2').paused).toBe(false);
    expect(repo.isKillSwitchActive('hh', 'cand-1')).toBe(false);
  });

  it('stores a safe provider error code instead of raw LinkedIn exception details', async () => {
    const db = new DatabaseSync(':memory:');
    const repo = new SqliteCandidateActionRepository(db);
    const runner = {
      async run(): Promise<RunnerOutcome> {
        throw new Error('https://www.linkedin.com/auth?token=synthetic-secret');
      },
    };
    const executor = new CandidateActionExecutor({
      repository: repo,
      runner,
      sessionResolver: sessionResolver(),
      consentStore: grantActionConsent(db),
      pause: async () => undefined,
    });

    const result = await executor.executeBatch({
      candidateId: 'cand-1',
      confirmedByCandidate: true,
      nowIso: daytime,
      actions: [
        {
          platform: 'linkedin',
          actionKind: 'linkedin_easy_apply',
          targetUrl: 'https://www.linkedin.com/jobs/view/123',
        },
      ],
    });

    expect(JSON.stringify(result)).not.toContain('synthetic-secret');
    expect(repo.getLinkedinSafetyStopStatus('cand-1')).toMatchObject({
      paused: true,
      reason: 'provider_error',
    });
  });

  it('does not dispatch concurrent LinkedIn runner calls for the same candidate', async () => {
    const db = new DatabaseSync(':memory:');
    const repo = new SqliteCandidateActionRepository(db);
    let markStarted!: () => void;
    let releaseRunner!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const blocked = new Promise<void>((resolve) => {
      releaseRunner = resolve;
    });
    const calls: string[] = [];
    const runner = {
      async run(action: { targetUrl: string }): Promise<RunnerOutcome> {
        calls.push(action.targetUrl);
        markStarted();
        await blocked;
        return { status: 'delivered', providerStatus: 'linkedin_application_submitted' };
      },
    };
    const executor = new CandidateActionExecutor({
      repository: repo,
      runner,
      sessionResolver: sessionResolver(),
      consentStore: grantActionConsent(db),
      pause: async () => undefined,
    });
    const action = {
      platform: 'linkedin' as const,
      actionKind: 'linkedin_easy_apply' as const,
      targetUrl: 'https://www.linkedin.com/jobs/view/123',
    };
    const first = executor.executeBatch({
      candidateId: 'cand-1',
      confirmedByCandidate: true,
      nowIso: daytime,
      actions: [action],
    });
    await started;
    const second = await executor.executeBatch({
      candidateId: 'cand-1',
      confirmedByCandidate: true,
      nowIso: daytime,
      actions: [action],
    });
    releaseRunner();
    await first;

    expect(calls).toEqual([action.targetUrl]);
    expect(second.receipts[0]?.failureCode).toBe('linkedin_action_in_progress');
  });
});
