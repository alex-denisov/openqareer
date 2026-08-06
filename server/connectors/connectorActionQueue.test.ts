import { describe, expect, it } from 'vitest';
import type { ConnectorReceipt } from './connectorHarness';
import {
  applyConnectorReceipt,
  createConnectorAction,
  markConnectorActionExecuting,
} from './connectorActionQueue';

const actionInput = {
  actionId: 'action-synthetic-001',
  idempotencyKey: '8463f97d-8539-42ea-8774-c79d6dd417f2',
  opportunityId: 'synthetic-opportunity-001',
  action: 'application' as const,
  autonomy: 'bounded_campaign' as const,
  createdAt: '2026-08-06T12:00:00.000Z',
};

function receipt(
  overrides: Partial<ConnectorReceipt> = {},
): ConnectorReceipt {
  return {
    connectorId: 'synthetic-hosted-form',
    transport: 'browser_session',
    action: actionInput.action,
    status: 'completed',
    idempotencyKey: actionInput.idempotencyKey,
    opportunityId: actionInput.opportunityId,
    providerReference: 'synthetic-application-001',
    evidence: {
      kind: 'dom_confirmation',
      observedAt: '2026-08-06T12:01:00.000Z',
    },
    ...overrides,
  };
}

describe('connector action queue projection', () => {
  it('projects a completed API or browser receipt into the same action state', () => {
    const executing = markConnectorActionExecuting(
      createConnectorAction(actionInput),
      '2026-08-06T12:00:30.000Z',
    );
    const browser = applyConnectorReceipt(
      executing,
      receipt(),
      '2026-08-06T12:01:00.000Z',
    );
    const api = applyConnectorReceipt(
      executing,
      receipt({
        connectorId: 'synthetic-api',
        transport: 'official_api',
        providerReference: 'api-application-001',
        evidence: {
          kind: 'provider_receipt',
          observedAt: '2026-08-06T12:01:00.000Z',
        },
      }),
      '2026-08-06T12:01:00.000Z',
    );

    expect(browser).toMatchObject({
      status: 'completed_with_receipt',
      connector: {
        id: 'synthetic-hosted-form',
        transport: 'browser_session',
        providerReference: 'synthetic-application-001',
      },
    });
    expect(api.status).toBe(browser.status);
    expect(api.history.map(({ to }) => to)).toEqual(
      browser.history.map(({ to }) => to),
    );
  });

  it('maps a challenge pause without retaining candidate payload', () => {
    const executing = markConnectorActionExecuting(
      createConnectorAction(actionInput),
      '2026-08-06T12:00:30.000Z',
    );
    const paused = applyConnectorReceipt(
      executing,
      receipt({
        status: 'paused',
        providerReference: undefined,
        evidence: null,
        diagnostic: {
          reason: 'challenge_detected',
          surfaceState: 'challenge',
          observedAt: '2026-08-06T12:01:00.000Z',
          surfaceFingerprint: 'challenge-heading',
        },
      }),
      '2026-08-06T12:01:00.000Z',
    );

    expect(paused).toMatchObject({
      status: 'paused',
      diagnosticReason: 'challenge_detected',
      connector: {
        providerReference: null,
      },
    });
    expect(JSON.stringify(paused)).not.toContain('Synthetic Candidate');
    expect(JSON.stringify(paused)).not.toContain('candidate@example.test');
  });

  it('fails closed on an envelope mismatch or illegal transition', () => {
    const drafted = createConnectorAction(actionInput);
    expect(() => applyConnectorReceipt(drafted, receipt(), actionInput.createdAt)).toThrow(
      'connector_action_not_executing',
    );
    const executing = markConnectorActionExecuting(
      drafted,
      '2026-08-06T12:00:30.000Z',
    );
    expect(() =>
      applyConnectorReceipt(
        executing,
        receipt({ opportunityId: 'different-opportunity' }),
        '2026-08-06T12:01:00.000Z',
      ),
    ).toThrow('connector_receipt_envelope_mismatch');
    expect(() =>
      applyConnectorReceipt(
        executing,
        receipt({ providerReference: 'candidate@example.test' }),
        '2026-08-06T12:01:00.000Z',
      ),
    ).toThrow('connector_receipt_invalid');
    expect(() =>
      applyConnectorReceipt(
        executing,
        {
          ...receipt(),
          status: 'unknown-runtime-status',
        } as unknown as ConnectorReceipt,
        '2026-08-06T12:01:00.000Z',
      ),
    ).toThrow('connector_receipt_invalid');
    expect(() =>
      markConnectorActionExecuting(executing, '2026-08-06T12:00:45.000Z'),
    ).toThrow('connector_action_not_drafted');
  });

  it('keeps native handoff honest and uncompleted', () => {
    const executing = markConnectorActionExecuting(
      createConnectorAction({ ...actionInput, autonomy: 'approve_once' }),
      '2026-08-06T12:00:30.000Z',
    );
    const handedOff = applyConnectorReceipt(
      executing,
      receipt({
        status: 'native_handoff',
        providerReference: undefined,
        evidence: null,
      }),
      '2026-08-06T12:01:00.000Z',
    );

    expect(handedOff.status).toBe('native_handoff');
    expect(handedOff.connector?.providerReference).toBeNull();
  });
});
