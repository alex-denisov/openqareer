import { describe, expect, it, vi } from 'vitest';
import {
  ConnectorHarness,
  type ConnectorExecutor,
  type ConnectorReceipt,
} from './connectorHarness';

const request = {
  idempotencyKey: '8463f97d-8539-42ea-8774-c79d6dd417f2',
  opportunityId: 'synthetic-opportunity-001',
  action: 'application' as const,
  payload: {
    fullName: 'Synthetic Candidate',
    email: 'candidate@example.test',
    coverNote: 'Synthetic fixture only.',
  },
};

function completedReceipt(input = request): ConnectorReceipt {
  return {
    connectorId: 'synthetic-hosted-form',
    transport: 'browser_session',
    action: 'application',
    status: 'completed',
    idempotencyKey: input.idempotencyKey,
    opportunityId: input.opportunityId,
    providerReference: 'synthetic-application-001',
    evidence: {
      kind: 'dom_confirmation',
      observedAt: '2026-08-06T12:00:00.000Z',
    },
  };
}

describe('connector harness', () => {
  it('rejects a zero action budget before accepting work', () => {
    expect(
      () => new ConnectorHarness({ executor: { execute: vi.fn() }, maxActions: 0 }),
    ).toThrow('connector_action_budget_invalid');
  });

  it('returns the cached receipt for a repeated idempotency key', async () => {
    const execute = vi.fn(async (input) => completedReceipt(input));
    const harness = new ConnectorHarness({
      executor: { execute } satisfies ConnectorExecutor,
      maxActions: 2,
    });

    const first = await harness.execute(request);
    const duplicate = await harness.execute(request);

    expect(first).toEqual(completedReceipt());
    expect(duplicate).toEqual(first);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(first)).not.toContain('Synthetic Candidate');
    expect(JSON.stringify(first)).not.toContain('candidate@example.test');
  });

  it('honours the global kill switch and action budget before mutation', async () => {
    const execute = vi.fn(async (input) => completedReceipt(input));
    const harness = new ConnectorHarness({ executor: { execute }, maxActions: 1 });

    harness.pause('owner_kill_switch');
    expect(await harness.execute(request)).toMatchObject({
      status: 'paused',
      diagnostic: { reason: 'owner_kill_switch' },
    });
    expect(execute).not.toHaveBeenCalled();

    harness.resume();
    expect(await harness.execute({ ...request, idempotencyKey: crypto.randomUUID() })).toMatchObject({
      status: 'completed',
    });
    expect(await harness.execute({ ...request, idempotencyKey: crypto.randomUUID() })).toMatchObject({
      status: 'paused',
      diagnostic: { reason: 'action_budget_exhausted' },
    });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('globally pauses after a connector challenge', async () => {
    const executor: ConnectorExecutor = {
      execute: vi.fn(async (input): Promise<ConnectorReceipt> => ({
        connectorId: 'synthetic-hosted-form',
        transport: 'browser_session',
        action: input.action,
        status: 'paused',
        idempotencyKey: input.idempotencyKey,
        opportunityId: input.opportunityId,
        evidence: null,
        diagnostic: {
          reason: 'challenge_detected',
          surfaceState: 'challenge',
          observedAt: '2026-08-06T12:00:00.000Z',
        },
      })),
    };
    const harness = new ConnectorHarness({ executor, maxActions: 2 });

    expect(await harness.execute(request)).toMatchObject({ status: 'paused' });
    expect(harness.state()).toEqual({
      status: 'paused',
      reason: 'challenge_detected',
      actionsUsed: 1,
      maxActions: 2,
    });
  });

  it('rejects a mismatched executor receipt and globally pauses', async () => {
    const harness = new ConnectorHarness({
      executor: {
        execute: vi.fn(async () => ({
          ...completedReceipt(),
          opportunityId: 'different-opportunity',
        })),
      },
      maxActions: 2,
      observedAt: () => '2026-08-06T12:00:00.000Z',
    });

    expect(await harness.execute(request)).toMatchObject({
      status: 'paused',
      diagnostic: { reason: 'receipt_invalid' },
    });
    expect(harness.state().status).toBe('paused');
  });

  it('rejects runtime receipt injection without reflecting its content', async () => {
    const harness = new ConnectorHarness({
      executor: {
        execute: vi.fn(async () => ({
          ...completedReceipt(),
          providerReference: 'candidate@example.test',
          diagnostic: {
            reason: 'candidate@example.test',
          },
        })),
      },
      maxActions: 1,
    });

    const result = await harness.execute(request);
    expect(result).toMatchObject({
      status: 'paused',
      diagnostic: { reason: 'receipt_invalid' },
    });
    expect(JSON.stringify(result)).not.toContain('candidate@example.test');
  });

  it('blocks a second application to the same opportunity under a new key', async () => {
    const execute = vi.fn(async (input) => completedReceipt(input));
    const harness = new ConnectorHarness({ executor: { execute }, maxActions: 3 });

    expect(await harness.execute(request)).toMatchObject({ status: 'completed' });
    expect(
      await harness.execute({ ...request, idempotencyKey: crypto.randomUUID() }),
    ).toMatchObject({
      status: 'paused',
      diagnostic: { reason: 'duplicate_target_action' },
    });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('pauses on an idempotency key reused for a different opportunity', async () => {
    const execute = vi.fn(async (input) => completedReceipt(input));
    const harness = new ConnectorHarness({ executor: { execute }, maxActions: 3 });
    await harness.execute(request);

    expect(
      await harness.execute({ ...request, opportunityId: 'synthetic-opportunity-002' }),
    ).toMatchObject({
      status: 'paused',
      diagnostic: { reason: 'idempotency_conflict' },
    });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('converts executor errors into a redacted pause receipt', async () => {
    const harness = new ConnectorHarness({
      executor: {
        execute: vi.fn(async () => {
          throw new Error('payload-must-never-reach-the-receipt');
        }),
      },
      maxActions: 1,
    });

    const receipt = await harness.execute(request);
    expect(receipt).toMatchObject({
      status: 'paused',
      diagnostic: {
        reason: 'unexpected_surface',
        surfaceFingerprint: 'executor-error',
      },
    });
    expect(JSON.stringify(receipt)).not.toContain('payload-must-never');
  });

  it('turns a transport rate limit into a global queue pause', async () => {
    const executor: ConnectorExecutor = {
      connectorId: 'synthetic-api',
      transport: 'official_api',
      execute: vi.fn(async (input): Promise<ConnectorReceipt> => ({
        connectorId: 'synthetic-api',
        transport: 'official_api',
        action: input.action,
        status: 'paused',
        idempotencyKey: input.idempotencyKey,
        opportunityId: input.opportunityId,
        evidence: null,
        diagnostic: {
          reason: 'rate_limited',
          observedAt: '2026-08-06T12:00:00.000Z',
        },
      })),
    };
    const harness = new ConnectorHarness({ executor, maxActions: 2 });

    expect(await harness.execute(request)).toMatchObject({
      status: 'paused',
      diagnostic: { reason: 'rate_limited' },
    });
    expect(harness.state()).toMatchObject({
      status: 'paused',
      reason: 'rate_limited',
    });
  });
});
