import { describe, expect, it } from 'vitest';
import type { RouteDeps } from './deps';
import { candidatePlan } from './helpers';

const repository = (plan: 'free' | 'pro') =>
  ({ getEffectivePlanForCandidate: () => plan }) as unknown as RouteDeps['billingRepository'];

describe('candidate plan for the fit sweep (B580)', () => {
  it('reads the stored plan when billing is enforced', () => {
    expect(
      candidatePlan(
        {
          config: { billingEnforcement: true } as RouteDeps['config'],
          billingRepository: repository('free'),
        },
        'c1',
      ),
    ).toBe('free');
  });

  it('gives the paid behaviour without billing enforcement, as LLM access does', () => {
    expect(
      candidatePlan(
        {
          config: { billingEnforcement: false } as RouteDeps['config'],
          billingRepository: repository('free'),
        },
        'c1',
      ),
    ).toBe('pro');
  });
});
