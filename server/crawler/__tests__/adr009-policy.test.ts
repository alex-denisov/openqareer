import { describe, expect, it } from 'vitest';
import { evaluateActionUnderAdr009 } from '../softSafeguard';
import { LinkedinAccountPool } from '../linkedinAccountPool';

describe('ADR-009 revision: server crawler pool and soft safeguard policy', () => {
  it('permits continuous server-side vacancy harvesting under test account pool', () => {
    const pool = new LinkedinAccountPool({
      accountIds: ['account-1', 'account-2', 'account-3'],
      storageRoot: 'data/crawlers/linkedin',
    });

    const decision = evaluateActionUnderAdr009({
      actionType: 'harvest_public_vacancies',
      targetPlatform: 'linkedin',
      isClientSession: false,
      accountPool: pool,
    });

    expect(decision.allowed).toBe(true);
    expect(decision.mode).toBe('server_test_pool');
    expect(decision.requiresCandidateConsent).toBe(false);
  });

  it('evaluates client session action, applies mitigations and produces soft warning if not confirmed', () => {
    const decision = evaluateActionUnderAdr009({
      actionType: 'auto_apply',
      targetPlatform: 'linkedin',
      isClientSession: true,
      confirmRisk: false,
    });

    expect(decision.allowed).toBe(false);
    expect(decision.mode).toBe('soft_safeguard_warning');
    expect(decision.riskLevel).toBe('high');
    expect(decision.warnings.length).toBeGreaterThan(0);
    expect(decision.mitigations).toEqual(
      expect.arrayContaining([
        expect.stringContaining('jitter'),
        expect.stringContaining('stealth'),
      ]),
    );
  });

  it('permits client session action without hard block when user explicitly confirms risk', () => {
    const decision = evaluateActionUnderAdr009({
      actionType: 'auto_apply',
      targetPlatform: 'linkedin',
      isClientSession: true,
      confirmRisk: true,
    });

    expect(decision.allowed).toBe(true);
    expect(decision.mode).toBe('soft_safeguard_confirmed');
    expect(decision.mitigationsApplied.length).toBeGreaterThan(0);
  });
});
