import { describe, expect, it, vi } from 'vitest';
import {
  ConnectorHarness,
  type ConnectorReceipt,
  type ConnectorRequest,
} from '../connectorHarness';
import { HhConnector } from './hhConnector';

describe('hh.ru governed write connector', () => {
  const fixedNow = '2026-08-14T12:00:00.000Z';
  const candidateId = '11111111-1111-4111-8111-111111111111';

  function request(
    overrides: Partial<ConnectorRequest> = {},
  ): ConnectorRequest {
    return {
      candidateId,
      action: 'application',
      idempotencyKey: '00000000-0000-4000-8000-000000000001',
      opportunityId: 'hh:vacancy:5555',
      payload: {
        commandId: '00000000-0000-4000-8000-000000000001',
        capability: 'application.submit',
        approvalId: '10000000-0000-4000-8000-000000000001',
        executionTarget: {
          platform: 'hh',
          vacancyId: '5555',
          resumeId: 'synthetic-resume-1',
          message: 'Подтверждённый кандидатом текст.',
        },
      },
      ...overrides,
    };
  }

  function completedReceipt(input: ConnectorRequest): ConnectorReceipt {
    return {
      connectorId: 'hh-browser-session',
      transport: 'browser_session',
      action: input.action,
      status: 'completed',
      idempotencyKey: input.idempotencyKey,
      opportunityId: input.opportunityId,
      providerReference: 'synthetic-response-1',
      evidence: { kind: 'dom_confirmation', observedAt: fixedNow },
    };
  }

  it('delegates one exact approved target to only the candidate-scoped session', async () => {
    const execute = vi.fn(async (input: ConnectorRequest) =>
      completedReceipt(input),
    );
    const getSession = vi.fn((requestedCandidateId: string) => {
      expect(requestedCandidateId).toBe(candidateId);
      return { execute };
    });
    const connector = new HhConnector({
      now: () => fixedNow,
      sessionResolver: { get: getSession },
    });
    const harness = new ConnectorHarness({
      executor: connector,
      maxActions: 1,
      observedAt: () => fixedNow,
    });

    const first = await harness.execute(request());
    const replay = await harness.execute(request());

    expect(first).toMatchObject({
      connectorId: 'hh-connector',
      transport: 'browser_session',
      status: 'completed',
      providerReference: 'synthetic-response-1',
      evidence: { kind: 'dom_confirmation' },
    });
    expect(replay).toEqual(first);
    expect(getSession).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledWith(request());
  });

  it('fails closed before browser access when approval binding is absent', async () => {
    const getSession = vi.fn(() => ({ execute: vi.fn() }));
    const connector = new HhConnector({
      now: () => fixedNow,
      sessionResolver: { get: getSession },
    });

    const receipt = await connector.execute(
      request({
        payload: {
          commandId: '00000000-0000-4000-8000-000000000001',
          capability: 'application.submit',
          executionTarget: {
            platform: 'hh',
            vacancyId: '5555',
            resumeId: 'synthetic-resume-1',
          },
        },
      }),
    );

    expect(receipt).toMatchObject({
      status: 'paused',
      diagnostic: { reason: 'hh_target_invalid' },
    });
    expect(getSession).not.toHaveBeenCalled();
  });

  it('uses no owner or anonymous fallback when the candidate session is absent', async () => {
    const connector = new HhConnector({ now: () => fixedNow });

    const receipt = await connector.execute(request());

    expect(receipt).toMatchObject({
      status: 'paused',
      diagnostic: {
        reason: 'hh_session_required',
        surfaceState: 'session_state',
      },
    });
    expect(JSON.stringify(receipt)).not.toMatch(/token|password|cookie|authorization/iu);
  });

  it('preserves a challenge stop from the browser session', async () => {
    const connector = new HhConnector({
      now: () => fixedNow,
      sessionResolver: {
        get() {
          return {
            async execute(input: ConnectorRequest): Promise<ConnectorReceipt> {
              return {
                connectorId: 'hh-browser-session',
                transport: 'browser_session',
                action: input.action,
                status: 'paused',
                idempotencyKey: input.idempotencyKey,
                opportunityId: input.opportunityId,
                evidence: null,
                diagnostic: {
                  reason: 'challenge_required',
                  surfaceState: 'challenge',
                  observedAt: fixedNow,
                  surfaceFingerprint: 'hh-robot-challenge',
                },
              };
            },
          };
        },
      },
    });

    const receipt = await connector.execute(request());

    expect(receipt).toMatchObject({
      connectorId: 'hh-connector',
      status: 'paused',
      diagnostic: { reason: 'challenge_required', surfaceState: 'challenge' },
    });
  });

  it('fails an action the hh.ru boundary does not implement', async () => {
    const getSession = vi.fn(() => ({ execute: vi.fn() }));
    const connector = new HhConnector({
      now: () => fixedNow,
      sessionResolver: { get: getSession },
    });

    const receipt = await connector.execute(request({ action: 'connection' }));

    expect(receipt).toMatchObject({
      status: 'failed',
      action: 'connection',
      diagnostic: { reason: 'unsupported_action_connection' },
    });
    expect(getSession).not.toHaveBeenCalled();
  });

  it('refuses an unscoped request that carries no candidate', async () => {
    const getSession = vi.fn(() => ({ execute: vi.fn() }));
    const connector = new HhConnector({
      now: () => fixedNow,
      sessionResolver: { get: getSession },
    });
    const unscoped: ConnectorRequest = { ...request() };
    delete unscoped.candidateId;

    const receipt = await connector.execute(unscoped);

    expect(receipt).toMatchObject({
      status: 'paused',
      diagnostic: {
        reason: 'hh_candidate_scope_required',
        surfaceState: 'session_state',
      },
    });
    expect(getSession).not.toHaveBeenCalled();
  });

  it('refuses a target that does not match the requested opportunity', async () => {
    const getSession = vi.fn(() => ({ execute: vi.fn() }));
    const connector = new HhConnector({
      now: () => fixedNow,
      sessionResolver: { get: getSession },
    });

    const receipt = await connector.execute(
      request({ opportunityId: 'hh:vacancy:9999' }),
    );

    expect(receipt).toMatchObject({
      status: 'paused',
      diagnostic: { reason: 'hh_target_mismatch' },
    });
    expect(getSession).not.toHaveBeenCalled();
  });

  it('pauses instead of surfacing a raw browser-session failure', async () => {
    const connector = new HhConnector({
      now: () => fixedNow,
      sessionResolver: {
        get() {
          return {
            execute() {
              return Promise.reject(
                new Error('storageState=cookie-value-must-never-leak'),
              );
            },
          };
        },
      },
    });

    const receipt = await connector.execute(request());

    expect(receipt).toMatchObject({
      status: 'paused',
      diagnostic: { reason: 'hh_session_failed' },
    });
    expect(JSON.stringify(receipt)).not.toContain('cookie-value-must-never-leak');
  });

  it('rejects a receipt that was issued for a different dispatch', async () => {
    const connector = new HhConnector({
      now: () => fixedNow,
      sessionResolver: {
        get() {
          return {
            async execute(input: ConnectorRequest): Promise<ConnectorReceipt> {
              return {
                ...completedReceipt(input),
                idempotencyKey: '00000000-0000-4000-8000-000000000099',
              };
            },
          };
        },
      },
    });

    const receipt = await connector.execute(request());

    expect(receipt).toMatchObject({
      status: 'paused',
      idempotencyKey: '00000000-0000-4000-8000-000000000001',
      diagnostic: { reason: 'receipt_invalid' },
    });
  });

  it('rejects a completion that lacks a DOM confirmation', async () => {
    const connector = new HhConnector({
      now: () => fixedNow,
      sessionResolver: {
        get() {
          return {
            async execute(input: ConnectorRequest): Promise<ConnectorReceipt> {
              return {
                ...completedReceipt(input),
                evidence: { kind: 'provider_receipt', observedAt: fixedNow },
              };
            },
          };
        },
      },
    });

    const receipt = await connector.execute(request());

    expect(receipt).toMatchObject({
      status: 'paused',
      diagnostic: { reason: 'hh_confirmation_invalid' },
    });
  });
});
