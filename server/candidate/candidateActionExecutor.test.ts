import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import {
  CandidateActionExecutor,
  type CandidateApplicationTracker,
  CandidateConfirmationRequiredError,
  CandidateConsentRequiredError,
  CandidateRunnerNotConnectedError,
  SimulatedCandidatePlatformRunner,
  type CandidateActionResult,
} from './candidateActionExecutor';
import { SqliteCandidateActionRepository } from './sqliteCandidateActionRepository';
import { SqliteCapabilityConsentStore } from '../auth/capabilityConsentStore';

describe('CandidateActionExecutor', () => {
  it('refuses a batch and records nothing when no real platform runner is connected', async () => {
    const db = new DatabaseSync(':memory:');
    const repo = new SqliteCandidateActionRepository(db);
    const executor = new CandidateActionExecutor({ repository: repo });

    await expect(
      executor.executeBatch({
        candidateId: 'cand-1',
        confirmedByCandidate: true,
        actions: [{ platform: 'hh', actionKind: 'hh_apply', targetUrl: 'https://hh.ru/vacancy/123' }],
      }),
    ).rejects.toThrow(CandidateRunnerNotConnectedError);
    expect(repo.listReceipts('cand-1', 10)).toHaveLength(0);
  });

  it('rejects execution when confirmedByCandidate is false', async () => {
    const db = new DatabaseSync(':memory:');
    const repo = new SqliteCandidateActionRepository(db);
    const executor = new CandidateActionExecutor({ repository: repo, runner: new SimulatedCandidatePlatformRunner() });

    await expect(
      executor.executeBatch({
        candidateId: 'cand-1',
        confirmedByCandidate: false,
        actions: [
          {
            platform: 'hh',
            actionKind: 'hh_apply',
            targetUrl: 'https://hh.ru/vacancy/123',
          },
        ],
      }),
    ).rejects.toThrow(CandidateConfirmationRequiredError);
  });

  it('rejects execution when consentStore is present but actions_on_behalf consent is missing', async () => {
    const db = new DatabaseSync(':memory:');
    const repo = new SqliteCandidateActionRepository(db);
    const consentStore = new SqliteCapabilityConsentStore(db);
    const executor = new CandidateActionExecutor({
      repository: repo,
      runner: new SimulatedCandidatePlatformRunner(),
      consentStore,
    });

    await expect(
      executor.executeBatch({
        candidateId: 'cand-1',
        confirmedByCandidate: true,
        actions: [
          {
            platform: 'hh',
            actionKind: 'hh_apply',
            targetUrl: 'https://hh.ru/vacancy/123',
          },
        ],
      }),
    ).rejects.toThrow(CandidateConsentRequiredError);
  });

  it('executes batch when confirmed and consent is granted', async () => {
    const db = new DatabaseSync(':memory:');
    const repo = new SqliteCandidateActionRepository(db);
    const consentStore = new SqliteCapabilityConsentStore(db);
    consentStore.recordConsent({
      userId: 'cand-1',
      capability: 'actions_on_behalf',
      versionId: 'actions_on_behalf-v1.0',
    });

    const executor = new CandidateActionExecutor({
      repository: repo,
      runner: new SimulatedCandidatePlatformRunner(),
      consentStore,
    });

    // 12:00 UTC = 15:00 Europe/Moscow (working daytime)
    const result = await executor.executeBatch({
      candidateId: 'cand-1',
      confirmedByCandidate: true,
      nowIso: '2026-10-01T12:00:00Z',
      actions: [
        {
          platform: 'hh',
          actionKind: 'hh_apply',
          targetUrl: 'https://hh.ru/vacancy/123',
          letterText: 'Сопроводительное письмо',
        },
      ],
    });

    expect(result.status).toBe('completed');
    expect(result.receipts).toHaveLength(1);
    expect(result.receipts[0].status).toBe('delivered');
    expect(result.receipts[0].platform).toBe('hh');
    expect(result.receipts[0].letterText).toBe('Сопроводительное письмо');

    // Daily usage updated
    const usage = repo.getDailyUsage('cand-1', '2026-10-01');
    expect(usage.hhAppliesCount).toBe(1);
  });

  it('marks action as attempted when kill switch is active', async () => {
    const db = new DatabaseSync(':memory:');
    const repo = new SqliteCandidateActionRepository(db);
    repo.setKillSwitch('platform:hh', true, 'Maintenance incident');

    const executor = new CandidateActionExecutor({ repository: repo, runner: new SimulatedCandidatePlatformRunner() });

    const result = await executor.executeBatch({
      candidateId: 'cand-1',
      confirmedByCandidate: true,
      nowIso: '2026-10-01T12:00:00Z',
      actions: [
        {
          platform: 'hh',
          actionKind: 'hh_apply',
          targetUrl: 'https://hh.ru/vacancy/123',
        },
      ],
    });

    expect(result.status).toBe('aborted');
    expect(result.receipts[0].status).toBe('attempted');
    expect(result.receipts[0].failureCode).toBe('kill_switch_active');

    // Usage must not increment
    const usage = repo.getDailyUsage('cand-1', '2026-10-01');
    expect(usage.hhAppliesCount).toBe(0);
  });

  it('marks action as attempted during quiet hours (23:00 - 08:00)', async () => {
    const db = new DatabaseSync(':memory:');
    const repo = new SqliteCandidateActionRepository(db);
    const executor = new CandidateActionExecutor({ repository: repo, runner: new SimulatedCandidatePlatformRunner() });

    // 01:00 UTC = 04:00 Europe/Moscow (quiet hours)
    const result = await executor.executeBatch({
      candidateId: 'cand-1',
      confirmedByCandidate: true,
      nowIso: '2026-10-01T01:00:00Z',
      clientTimezone: 'Europe/Moscow',
      actions: [
        {
          platform: 'hh',
          actionKind: 'hh_apply',
          targetUrl: 'https://hh.ru/vacancy/123',
        },
      ],
    });

    expect(result.status).toBe('aborted');
    expect(result.receipts[0].status).toBe('attempted');
    expect(result.receipts[0].failureCode).toBe('quiet_hours');
  });

  it('handles partial failure and correctly aggregates batch status', async () => {
    const db = new DatabaseSync(':memory:');
    const repo = new SqliteCandidateActionRepository(db);

    const runner = {
      async executeAction(
        _candidateId: string,
        action: { targetUrl: string },
      ): Promise<CandidateActionResult> {
        if (action.targetUrl.includes('fail')) {
          return { status: 'attempted', failureCode: 'captcha_required' };
        }
        return { status: 'delivered', confirmationUrl: 'https://hh.ru/applied' };
      },
    };

    const executor = new CandidateActionExecutor({ repository: repo, runner });

    const result = await executor.executeBatch({
      candidateId: 'cand-1',
      confirmedByCandidate: true,
      nowIso: '2026-10-01T12:00:00Z',
      actions: [
        {
          platform: 'hh',
          actionKind: 'hh_apply',
          targetUrl: 'https://hh.ru/vacancy/success',
        },
        {
          platform: 'hh',
          actionKind: 'hh_apply',
          targetUrl: 'https://hh.ru/vacancy/fail',
        },
      ],
    });

    expect(result.status).toBe('partial_failure');
    expect(result.receipts[0].status).toBe('delivered');
    expect(result.receipts[1].status).toBe('attempted');
    expect(result.receipts[1].failureCode).toBe('captcha_required');
  });

  it('updates application to applied on delivered and never on attempted (B251 DoD)', async () => {
    const db = new DatabaseSync(':memory:');
    const repo = new SqliteCandidateActionRepository(db);

    const patchedApps: Record<string, string> = { 'app-1': 'saved', 'app-2': 'saved' };
    const recordedEvents: Array<{ appId: string; kind: string; note?: string }> = [];

    const mockTracker: CandidateApplicationTracker = {
      getApplication: (_candId: string, appId: string) => ({
        version: 1,
        stage: patchedApps[appId] || 'saved',
      }),
      patchApplication: (_candId: string, appId: string, patch: { stage?: string }) => {
        if (patch.stage) patchedApps[appId] = patch.stage;
        return { id: appId, stage: patchedApps[appId] };
      },
      recordApplicationEvent: (_candId: string, appId: string, evt: { kind: 'follow_up_sent' | 'thank_you_sent' | 'promise'; note?: string | null }) => {
        recordedEvents.push({ appId, kind: evt.kind, note: evt.note ?? undefined });
        return { id: appId };
      },
    };

    const runner = {
      async executeAction(
        _candidateId: string,
        action: { targetUrl: string },
      ): Promise<CandidateActionResult> {
        if (action.targetUrl.includes('fail')) {
          return { status: 'attempted', failureCode: 'session_expired' };
        }
        return { status: 'delivered', confirmationUrl: 'https://hh.ru/applied/123' };
      },
    };

    const executor = new CandidateActionExecutor({
      repository: repo,
      runner,
      applicationTracker: mockTracker,
    });

    const result = await executor.executeBatch({
      candidateId: 'cand-1',
      confirmedByCandidate: true,
      nowIso: '2026-10-01T12:00:00Z',
      actions: [
        {
          platform: 'hh',
          actionKind: 'hh_apply',
          applicationId: 'app-1',
          targetUrl: 'https://hh.ru/vacancy/success',
        },
        {
          platform: 'hh',
          actionKind: 'hh_apply',
          applicationId: 'app-2',
          targetUrl: 'https://hh.ru/vacancy/fail',
        },
      ],
    });

    expect(result.status).toBe('partial_failure');
    // app-1 was delivered -> stage moved to 'applied'
    expect(patchedApps['app-1']).toBe('applied');
    // app-2 was attempted (failed) -> stage stayed 'saved' (NEVER applied)
    expect(patchedApps['app-2']).toBe('saved');
    // app-2 received note event
    expect(recordedEvents).toHaveLength(1);
    expect(recordedEvents[0].appId).toBe('app-2');
    expect(recordedEvents[0].kind).toBe('promise');
    expect(recordedEvents[0].note).toContain('session_expired');
  });

  it('pauses only this candidate’s LinkedIn actions on a platform restriction and blocks the rest of the batch', async () => {
    const db = new DatabaseSync(':memory:');
    const repo = new SqliteCandidateActionRepository(db);
    const calls: string[] = [];
    const runner = {
      async executeAction(_candidateId: string, action: { platform: string; targetUrl: string }): Promise<CandidateActionResult> {
        calls.push(action.targetUrl);
        if (action.targetUrl.includes('restricted')) return {
          status: 'attempted',
          failureCode: 'http_429',
          confirmationUrl: 'https://www.linkedin.com/checkpoint?token=synthetic-secret',
        };
        return { status: 'delivered' };
      },
    };
    const executor = new CandidateActionExecutor({ repository: repo, runner });

    const result = await executor.executeBatch({
      candidateId: 'cand-1',
      confirmedByCandidate: true,
      nowIso: '2026-10-01T12:00:00Z',
      actions: [
        { platform: 'linkedin', actionKind: 'linkedin_easy_apply', targetUrl: 'https://www.linkedin.com/jobs/restricted' },
        { platform: 'linkedin', actionKind: 'linkedin_easy_apply', targetUrl: 'https://www.linkedin.com/jobs/next' },
        { platform: 'hh', actionKind: 'hh_apply', targetUrl: 'https://hh.ru/vacancy/123' },
      ],
    });

    expect(calls).toEqual([
      'https://www.linkedin.com/jobs/restricted',
      'https://hh.ru/vacancy/123',
    ]);
    expect(result.receipts.map(({ failureCode }) => failureCode)).toEqual([
      'platform_restricted',
      'kill_switch_active',
      null,
    ]);
    expect(result.receipts[0].confirmationUrl).toBeNull();
    expect(JSON.stringify(result)).not.toContain('synthetic-secret');
    expect(result.status).toBe('partial_failure');
    expect(repo.getLinkedinSafetyStopStatus('cand-1')).toMatchObject({
      paused: true,
      reason: 'platform_restricted',
      canResume: true,
    });
  });

  it('stores a safe provider error code instead of raw LinkedIn exception details', async () => {
    const db = new DatabaseSync(':memory:');
    const repo = new SqliteCandidateActionRepository(db);
    const runner = {
      async executeAction(): Promise<CandidateActionResult> {
        throw new Error('https://www.linkedin.com/auth?token=synthetic-secret');
      },
    };
    const executor = new CandidateActionExecutor({ repository: repo, runner });

    const result = await executor.executeBatch({
      candidateId: 'cand-1',
      confirmedByCandidate: true,
      nowIso: '2026-10-01T12:00:00Z',
      actions: [{ platform: 'linkedin', actionKind: 'linkedin_easy_apply', targetUrl: 'https://www.linkedin.com/jobs/123' }],
    });

    expect(result.receipts[0].failureCode).toBe('provider_error');
    expect(JSON.stringify(result)).not.toContain('synthetic-secret');
    expect(repo.getLinkedinSafetyStopStatus('cand-1')).toMatchObject({ paused: true, reason: 'provider_error' });
  });

  it('does not dispatch concurrent LinkedIn runner calls for the same candidate', async () => {
    const db = new DatabaseSync(':memory:');
    const repo = new SqliteCandidateActionRepository(db);
    let markStarted!: () => void;
    let releaseRunner!: () => void;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    const blocked = new Promise<void>((resolve) => { releaseRunner = resolve; });
    const calls: string[] = [];
    const runner = {
      async executeAction(_candidateId: string, action: { targetUrl: string }): Promise<CandidateActionResult> {
        calls.push(action.targetUrl);
        markStarted();
        await blocked;
        return { status: 'delivered' };
      },
    };
    const executor = new CandidateActionExecutor({ repository: repo, runner });
    const action = {
      platform: 'linkedin' as const,
      actionKind: 'linkedin_easy_apply' as const,
      targetUrl: 'https://www.linkedin.com/jobs/123',
    };
    const first = executor.executeBatch({
      candidateId: 'cand-1',
      confirmedByCandidate: true,
      nowIso: '2026-10-01T12:00:00Z',
      actions: [action],
    });
    await started;
    const second = executor.executeBatch({
      candidateId: 'cand-1',
      confirmedByCandidate: true,
      nowIso: '2026-10-01T12:00:00Z',
      actions: [{ ...action, targetUrl: 'https://www.linkedin.com/jobs/456' }],
    });
    releaseRunner();
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(calls).toEqual(['https://www.linkedin.com/jobs/123']);
    expect(firstResult.status).toBe('completed');
    expect(secondResult.status).toBe('aborted');
    expect(secondResult.receipts[0].failureCode).toBe('linkedin_action_in_progress');
  });
});
