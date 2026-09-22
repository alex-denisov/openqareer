import { describe, expect, it } from 'vitest';
import { evaluateActionUnderAdr009 } from '../softSafeguard';

describe('ADR-009 provider boundary', () => {
  it('fails closed when a pool exists without provider permission', () => {
    const decision = evaluateActionUnderAdr009({
      actionType: 'harvest_public_vacancies',
      targetPlatform: 'linkedin',
      isClientSession: false,
    });

    expect(decision.allowed).toBe(false);
    expect(decision.mode).toBe('rejected');
    expect(decision.requiresCandidateConsent).toBe(false);
    expect(decision.warnings.join(' ')).toContain('provider_permission_required');
  });

  it('rejects client-session automation even when a caller confirms risk', () => {
    const decision = evaluateActionUnderAdr009({
      actionType: 'auto_apply',
      targetPlatform: 'linkedin',
      isClientSession: true,
      confirmRisk: false,
    });

    expect(decision.allowed).toBe(false);
    expect(decision.mode).toBe('rejected');
    expect(decision.riskLevel).toBe('high');
    expect(decision.warnings.length).toBeGreaterThan(0);
    expect(decision.mitigations).toEqual([]);
  });
});
