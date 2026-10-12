import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type { ExecuteBatchInput, ExecuteBatchResult } from './candidateActionExecutor';
import {
  CandidateConsentRequiredError,
  CandidateRunnerNotConnectedError,
} from './candidateActionExecutor';
import {
  SqliteCandidateAutomationRepository,
  type CandidateAutomationQueuePayload,
} from './sqliteCandidateAutomationRepository';
import { CandidateAutomationDispatch } from './candidateAutomationDispatch';

const KEY = Buffer.alloc(32, 29);
const NOW = '2026-10-12T07:00:00.000Z';

function setup() {
  const database = new DatabaseSync(':memory:');
  database.exec(
    "CREATE TABLE candidates (id TEXT PRIMARY KEY) STRICT; INSERT INTO candidates VALUES ('alice');",
  );
  const repository = new SqliteCandidateAutomationRepository(database, KEY);
  repository.acceptConsent('alice', 'drafts', 'B452-1', 'drafts');
  repository.acceptConsent('alice', 'send_after_approval', 'B452-1', 'send');
  repository.saveSettings('alice', {
    enabled: true,
    mode: 'approval_required',
    rules: {
      roles: ['Head of Engineering'],
      minimumMatchPercent: 80,
      platforms: ['hh', 'linkedin'],
      excludeStopCompanies: true,
    },
  });
  return { database, repository };
}

function addApproved(
  repository: SqliteCandidateAutomationRepository,
  payload: Partial<CandidateAutomationQueuePayload> = {},
) {
  const item = repository.addQueueItem(
    'alice',
    {
      clusterId: 'cluster-default',
      applicationId: 'application-a',
      platform: 'hh',
      title: 'Head of Engineering',
      role: 'Head of Engineering',
      company: 'Acme',
      targetUrl: 'https://hh.ru/vacancy/1',
      requirements: { matched: 4, total: 5 },
      letterText: 'Одобренный текст',
      materials: [],
      ...payload,
    },
    'today',
    false,
    NOW,
  );
  return repository.transitionQueueItem('alice', item.id, 'approve', NOW)!;
}

function fakeExecutor(status: 'delivered' | 'attempted' | 'failed' = 'delivered') {
  const calls: ExecuteBatchInput[] = [];
  const executor = {
    calls,
    executeBatch: async (input: ExecuteBatchInput): Promise<ExecuteBatchResult> => {
      calls.push(input);
      const action = input.actions[0]!;
      return {
        batchId: input.batchId ?? 'batch-a',
        status: status === 'delivered' ? 'completed' : 'partial_failure',
        receipts: [
          {
            id: action.id!,
            batchId: input.batchId ?? 'batch-a',
            candidateId: input.candidateId,
            platform: action.platform,
            actionKind: action.actionKind,
            status,
            applicationId: action.applicationId ?? null,
            failureCode: status === 'delivered' ? null : 'provider_error',
            executedAt: NOW,
            createdAt: NOW,
          },
        ],
      };
    },
  };
  return executor;
}

describe('CandidateAutomationDispatch', () => {
  it('waits for a randomized window, executes through B370, and journals its receipt', async () => {
    const { repository } = setup();
    const item = addApproved(repository);
    const executor = fakeExecutor();
    const dispatch = new CandidateAutomationDispatch({ repository, executor, random: () => 0 });

    expect(await dispatch.runCandidate('alice', new Date(NOW))).toMatchObject({
      status: 'waiting',
    });
    expect(executor.calls).toHaveLength(0);
    const result = await dispatch.runCandidate('alice', new Date('2026-10-12T07:02:00.000Z'));

    expect(result).toMatchObject({ status: 'delivered', queueItemId: item.id, receiptId: item.id });
    expect(executor.calls[0]).toMatchObject({
      confirmedByCandidate: true,
      actions: [{ id: item.id, actionKind: 'hh_apply' }],
    });
    expect(repository.getQueueItem('alice', item.id)?.status).toBe('sent');
    expect(
      repository.schedulerRepository.listJournal('alice', { now: '2026-10-12T07:03:00.000Z' }),
    ).toMatchObject([{ result: 'delivered', receiptId: item.id, company: 'Acme' }]);
  });

  it('records the daily limit and does not call the executor after quota is used', async () => {
    const { repository } = setup();
    const schedule = repository.schedulerRepository.getSchedule('alice');
    repository.schedulerRepository.saveSchedule('alice', {
      ...schedule,
      dailyLimits: { hh: 1, linkedin: 10 },
    });
    const first = addApproved(repository, { clusterId: 'cluster-first' });
    repository.schedulerRepository.appendJournalEntry({
      candidateId: 'alice',
      queueItemId: first.id,
      platform: 'hh',
      result: 'delivered',
      receiptStatus: 'delivered',
      attempted: true,
      localDate: '2026-10-12',
      company: 'Acme',
      occurredAt: NOW,
      receiptId: 'previous-receipt',
      eventKey: 'previous-receipt',
    });
    addApproved(repository, { clusterId: 'cluster-next' });
    repository.schedulerRepository.setRuntime('alice', { nextSendAt: NOW }, NOW);
    const executor = fakeExecutor();
    const dispatch = new CandidateAutomationDispatch({ repository, executor, random: () => 0 });

    const result = await dispatch.runCandidate('alice', new Date(NOW));

    expect(result.status).toBe('daily_limit_reached');
    expect(executor.calls).toHaveLength(0);
    expect(repository.schedulerRepository.getRuntime('alice').status).toBe('daily_limit_reached');
  });

  it('stops after an executor error and records it without claiming delivery', async () => {
    const { repository } = setup();
    const item = addApproved(repository);
    addApproved(repository, { clusterId: 'cluster-next' });
    repository.schedulerRepository.setRuntime('alice', { nextSendAt: NOW }, NOW);
    const executor = fakeExecutor('failed');
    const dispatch = new CandidateAutomationDispatch({ repository, executor, random: () => 0 });

    const result = await dispatch.runCandidate('alice', new Date(NOW));

    expect(result).toMatchObject({ status: 'error', queueItemId: item.id });
    expect(repository.getQueueItem('alice', item.id)?.status).toBe('failed');
    expect(
      repository.schedulerRepository.listJournal('alice', { now: '2026-10-12T07:03:00.000Z' }),
    ).toMatchObject([{ result: 'error', receiptStatus: 'failed', receiptId: item.id }]);
    expect(repository.getNextApprovedQueueItem('alice')?.payload.clusterId).toBe('cluster-next');
    expect(
      await dispatch.runCandidate('alice', new Date('2026-10-12T07:00:01.000Z')),
    ).toMatchObject({ status: 'error', failureCode: 'provider_error' });
    expect(executor.calls).toHaveLength(1);
  });

  it('holds a LinkedIn item as not connected and prevents further candidate dispatch', async () => {
    const { repository } = setup();
    const item = addApproved(repository, { clusterId: 'linkedin-a', platform: 'linkedin' });
    repository.schedulerRepository.setRuntime('alice', { nextSendAt: NOW }, NOW);
    const executor = {
      calls: 0,
      executeBatch: async () => {
        executor.calls += 1;
        throw new CandidateRunnerNotConnectedError();
      },
    };
    const dispatch = new CandidateAutomationDispatch({ repository, executor, random: () => 0 });

    const result = await dispatch.runCandidate('alice', new Date(NOW));
    const journal = repository.schedulerRepository.listJournal('alice', {
      now: '2026-10-12T07:03:00.000Z',
    });

    expect(result).toMatchObject({ status: 'linkedin_not_connected', queueItemId: item.id });
    expect(repository.getQueueItem('alice', item.id)?.status).toBe('approved');
    expect(journal).toMatchObject([
      { result: 'error', attempted: false, failureCode: 'linkedin_not_connected' },
    ]);
    expect(await dispatch.runDue(new Date('2026-10-12T07:04:00.000Z'))).toEqual([]);
    expect(executor.calls).toBe(1);
  });

  it('reports the distinct B370 consent requirement without claiming delivery', async () => {
    const { repository } = setup();
    const item = addApproved(repository);
    repository.schedulerRepository.setRuntime('alice', { nextSendAt: NOW }, NOW);
    const executor = {
      executeBatch: async () => {
        throw new CandidateConsentRequiredError();
      },
    };
    const dispatch = new CandidateAutomationDispatch({ repository, executor, random: () => 0 });

    const result = await dispatch.runCandidate('alice', new Date(NOW));

    expect(result).toMatchObject({
      status: 'paused',
      failureCode: 'actions_on_behalf_consent_required',
    });
    expect(repository.getQueueItem('alice', item.id)?.status).toBe('approved');
    expect(
      repository.schedulerRepository.listJournal('alice', { now: '2026-10-12T07:03:00.000Z' }),
    ).toEqual([]);
  });

  it('rechecks automation consent after resolving the device session', async () => {
    const { repository } = setup();
    const item = addApproved(repository);
    repository.schedulerRepository.setRuntime('alice', { nextSendAt: NOW }, NOW);
    let providerCalls = 0;
    const executor = {
      executeBatch: async (input: ExecuteBatchInput) => {
        repository.revokeConsent('alice', 'send_after_approval', '2026-10-12T07:00:00.500Z');
        expect(input.beforeExecute).toBeTypeOf('function');
        if (!input.beforeExecute!()) throw new CandidateConsentRequiredError();
        providerCalls += 1;
        throw new Error('provider execution should be blocked after revocation');
      },
    };
    const dispatch = new CandidateAutomationDispatch({ repository, executor, random: () => 0 });

    const result = await dispatch.runCandidate('alice', new Date(NOW));

    expect(result).toMatchObject({ status: 'paused', failureCode: 'automation_consent_required' });
    expect(repository.getQueueItem('alice', item.id)?.status).toBe('pending_approval');
    expect(repository.schedulerRepository.listJournal('alice', { now: '2026-10-12T07:03:00.000Z' })).toEqual([]);
    expect(providerCalls).toBe(0);
  });

  it('stops the candidate series after the first provider error', async () => {
    const { repository } = setup();
    addApproved(repository, { clusterId: 'error-a' });
    addApproved(repository, { clusterId: 'error-b' });
    addApproved(repository, { clusterId: 'error-c' });
    repository.schedulerRepository.setRuntime('alice', { nextSendAt: NOW }, NOW);
    const executor = fakeExecutor('failed');
    const dispatch = new CandidateAutomationDispatch({ repository, executor, random: () => 0 });

    const first = await dispatch.runCandidate('alice', new Date(NOW));

    expect(first).toMatchObject({ status: 'error', failureCode: 'provider_error' });
    expect(repository.schedulerRepository.getRuntime('alice')).toMatchObject({
      status: 'error',
      consecutiveErrors: 1,
    });
    expect(await dispatch.runDue(new Date('2026-10-12T07:06:00.000Z'))).toEqual([]);
    expect(repository.getNextApprovedQueueItem('alice')?.payload.clusterId).toBe('error-b');
    expect(executor.calls).toHaveLength(1);
  });

  it('takes a two-hour break after eight delivered replies', async () => {
    const { repository } = setup();
    for (let index = 0; index < 8; index += 1)
      addApproved(repository, { clusterId: `break-${index}` });
    const firstSend = new Date('2026-10-12T07:02:00.000Z');
    repository.schedulerRepository.setRuntime(
      'alice',
      { nextSendAt: firstSend.toISOString() },
      NOW,
    );
    const executor = fakeExecutor();
    const dispatch = new CandidateAutomationDispatch({ repository, executor, random: () => 0 });

    for (let index = 0; index < 8; index += 1) {
      await dispatch.runCandidate('alice', new Date(firstSend.getTime() + index * 2 * 60_000));
    }

    expect(repository.schedulerRepository.getRuntime('alice')).toMatchObject({
      sentSinceBreak: 0,
      pauseUntil: '2026-10-12T09:16:00.000Z',
      nextSendAt: '2026-10-12T09:18:00.000Z',
    });
    expect(executor.calls).toHaveLength(8);
  });
});
