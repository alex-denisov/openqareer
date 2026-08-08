import { describe, expect, it } from 'vitest';
import { ConnectorHarness } from './connectorHarness';
import {
  DryRunPlatformConnector,
  getPlatformCapabilityMatrix,
} from './platformCapabilityRegistry';

describe('platform capability registry', () => {
  it('reports missing test credentials as typed readiness without exposing values', () => {
    const matrix = getPlatformCapabilityMatrix({
      OPENQAREER_LINKEDIN_TEST_USERNAME: 'candidate-test@example.invalid',
      OPENQAREER_LINKEDIN_TEST_PASSWORD: 'secret-value',
    });
    const linkedinApply = matrix.find(
      (item) => item.platform === 'linkedin' && item.action === 'application',
    );
    const hhApply = matrix.find(
      (item) => item.platform === 'hh' && item.action === 'application',
    );
    const serialized = JSON.stringify(matrix);

    expect(linkedinApply).toMatchObject({
      readiness: 'ready_for_test',
      configured: true,
    });
    expect(hhApply).toMatchObject({
      readiness: 'credentials_required',
      configured: false,
    });
    expect(serialized).not.toContain('secret-value');
    expect(serialized).not.toContain('candidate-test@example.invalid');
  });

  it('emits a receipt in dry-run mode without completing an external action', async () => {
    const executor = new DryRunPlatformConnector('linkedin');
    const harness = new ConnectorHarness({ executor, maxActions: 1 });

    const receipt = await harness.execute({
      idempotencyKey: 'f0dfef17-087c-49d9-b0bb-f21c16b0c1b4',
      opportunityId: 'opportunity-test-1',
      action: 'application',
      payload: {
        candidate: 'synthetic-only',
        password: 'must-never-appear-in-receipt',
      },
    });

    expect(receipt).toMatchObject({
      connectorId: 'linkedin-dry-run',
      transport: 'native_handoff',
      status: 'native_handoff',
      diagnostic: { reason: 'dry_run_only' },
    });
    expect(receipt.evidence).toBeNull();
    expect(JSON.stringify(receipt)).not.toContain('must-never-appear');
  });

  it('respects the owner kill switch before a dry-run action is dispatched', async () => {
    const executor = new DryRunPlatformConnector('hh');
    const harness = new ConnectorHarness({ executor, maxActions: 1 });
    harness.pause();

    const receipt = await harness.execute({
      idempotencyKey: '9b54039b-cccf-488d-bf06-a288c0ab1a18',
      opportunityId: 'opportunity-test-2',
      action: 'application',
      payload: {},
    });

    expect(receipt.status).toBe('paused');
    expect(receipt.diagnostic?.reason).toBe('owner_kill_switch');
  });
});
