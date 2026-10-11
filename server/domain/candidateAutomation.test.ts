import { describe, expect, it } from 'vitest';
import {
  companyStopKey,
  matchesCandidateAutomationRules,
  transitionCandidateAutomationQueue,
  type CandidateAutomationOpportunity,
  type CandidateAutomationRules,
} from './candidateAutomation';

const rules: CandidateAutomationRules = {
  roles: ['Head of Engineering', 'Director of Engineering'],
  minimumMatchPercent: 80,
  platforms: ['hh', 'linkedin'],
  excludeStopCompanies: true,
};

function opportunity(
  overrides: Partial<CandidateAutomationOpportunity> = {},
): CandidateAutomationOpportunity {
  return {
    roleMatch: 'target',
    requirements: { matched: 4, total: 5 },
    platform: 'hh',
    company: 'Пример',
    ...overrides,
  };
}

describe('candidate automation rules', () => {
  it('keeps supported platforms and candidates meeting role and requirement rules', () => {
    expect(matchesCandidateAutomationRules(opportunity(), rules, new Set())).toBe(true);
    expect(
      matchesCandidateAutomationRules(
        opportunity({ platform: 'linkedin' }),
        rules,
        new Set(),
      ),
    ).toBe(true);
  });

  it('fails closed for unknown requirements, weak matches, unsupported platforms and stopped companies', () => {
    expect(
      matchesCandidateAutomationRules(opportunity({ requirements: undefined }), rules, new Set()),
    ).toBe(false);
    expect(
      matchesCandidateAutomationRules(
        opportunity({ requirements: { matched: 3, total: 5 } }),
        rules,
        new Set(),
      ),
    ).toBe(false);
    expect(
      matchesCandidateAutomationRules(opportunity({ platform: 'other' }), rules, new Set()),
    ).toBe(false);
    expect(
      matchesCandidateAutomationRules(
        opportunity(),
        rules,
        new Set([companyStopKey(' ПРИМЕР  ')].filter((key): key is string => Boolean(key))),
      ),
    ).toBe(false);
  });

  it('normalizes company names for manual and rejection stop entries', () => {
    expect(companyStopKey('  Acme\u00a0Group ')).toBe(companyStopKey('acme group'));
    expect(companyStopKey('')).toBeNull();
  });
});

describe('candidate automation queue transitions', () => {
  it('requires a ready letter before approval and only approves waiting entries', () => {
    expect(() =>
      transitionCandidateAutomationQueue('letter_not_ready', 'approve', false),
    ).toThrow('automation_letter_not_ready');
    expect(transitionCandidateAutomationQueue('pending_approval', 'approve', true)).toBe(
      'approved',
    );
    expect(() => transitionCandidateAutomationQueue('removed', 'approve', true)).toThrow(
      'automation_transition_not_allowed',
    );
  });

  it('supports removal and consultant handoff without claiming provider delivery', () => {
    expect(transitionCandidateAutomationQueue('pending_approval', 'remove', true)).toBe('removed');
    expect(
      transitionCandidateAutomationQueue('letter_not_ready', 'consultant', false),
    ).toBe('consultant');
    expect(transitionCandidateAutomationQueue('approved', 'sent', true)).toBe('sent');
  });
});
