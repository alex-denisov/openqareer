import { describe, expect, it, vi } from 'vitest';
import type { ConnectorRequest } from './connectorHarness';
import { CareerCommandConnectorRouter } from './careerCommandConnectorRouter';

describe('career command connector router', () => {
  const request: ConnectorRequest = {
    candidateId: '11111111-1111-4111-8111-111111111111',
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
      },
    },
  };

  it('routes an exact hh.ru target to the governed hh executor', async () => {
    const execute = vi.fn(async (input: ConnectorRequest) => ({
      connectorId: 'hh-connector',
      transport: 'browser_session' as const,
      action: input.action,
      status: 'paused' as const,
      idempotencyKey: input.idempotencyKey,
      opportunityId: input.opportunityId,
      evidence: null,
      diagnostic: { reason: 'hh_session_required' },
    }));
    const router = new CareerCommandConnectorRouter({ hh: { execute } });

    const receipt = await router.execute(request);

    expect(receipt.diagnostic?.reason).toBe('hh_session_required');
    expect(execute).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledWith(request);
  });

  it('keeps an unbound or unsupported target in an explicit native handoff', async () => {
    const execute = vi.fn();
    const router = new CareerCommandConnectorRouter({ hh: { execute } });
    const unbound = {
      ...request,
      opportunityId: `command:${request.idempotencyKey}`,
      payload: {
        commandId: request.idempotencyKey,
        capability: 'application.submit',
        approvalId: '10000000-0000-4000-8000-000000000001',
        executionTarget: null,
      },
    } satisfies ConnectorRequest;

    const receipt = await router.execute(unbound);

    expect(receipt).toMatchObject({
      connectorId: 'governed-native-handoff',
      transport: 'native_handoff',
      status: 'native_handoff',
      diagnostic: { reason: 'external_target_not_bound' },
    });
    expect(execute).not.toHaveBeenCalled();
  });
});
