import { describe, expect, it } from 'vitest';
import {
  ONBOARDING_ROLE_HYPOTHESIS_THRESHOLD,
  buildOnboardingRoleCards,
} from './onboardingRoleCards';
import type { ParsedResumeExperience } from '../workspace/resumeParserTypes';

function job(overrides: Partial<ParsedResumeExperience>): ParsedResumeExperience {
  return {
    title: 'VP of Technology Operations',
    employer: 'OptiLab AI',
    current: true,
    responsibilities: [],
    achievements: [],
    ...overrides,
  };
}

describe('buildOnboardingRoleCards', () => {
  it('leads with the stated target role and folds in distinct recent titles', () => {
    const cards = buildOnboardingRoleCards({
      targetRole: 'VP of Technology Operations',
      experience: [
        job({ title: 'VP of Technology Operations', achievements: ['P&L $40M+'] }),
        job({ title: 'Head of IT Operations', achievements: ['ITIL, DevOps с нуля'] }),
      ],
    });
    expect(cards.map((card) => card.title)).toEqual([
      'VP of Technology Operations',
      'Head of IT Operations',
    ]);
    expect(cards[0].evidenceTags).toEqual(['P&L $40M+']);
  });

  it('drops a title that repeats the target role, case-insensitively', () => {
    const cards = buildOnboardingRoleCards({
      targetRole: 'VP of Technology Operations',
      experience: [
        job({ title: 'vp of technology operations' }),
        job({ title: 'Head of IT Operations' }),
      ],
    });
    expect(cards).toHaveLength(2);
  });

  it('caps the card list at three roles', () => {
    const cards = buildOnboardingRoleCards({
      targetRole: 'VP of Technology Operations',
      experience: [
        job({ title: 'Head of IT Operations' }),
        job({ title: 'Chief Operating Officer' }),
        job({ title: 'Director of Engineering' }),
      ],
    });
    expect(cards).toHaveLength(3);
  });

  it('leaves vacancy counts and the hypothesis flag unset until a count arrives', () => {
    const [card] = buildOnboardingRoleCards({
      targetRole: 'VP of Technology Operations',
      experience: [],
    });
    expect(card.vacancyCount).toBeUndefined();
    expect(card.isHypothesis).toBeUndefined();
  });

  it('flags a role a hypothesis once its count is below the significance threshold', () => {
    const [card] = buildOnboardingRoleCards({
      targetRole: 'Chief Operating Officer',
      experience: [],
      vacancyCountsByRole: { 'Chief Operating Officer': 6 },
    });
    expect(card.vacancyCount).toBe(6);
    expect(card.isHypothesis).toBe(true);
    expect(ONBOARDING_ROLE_HYPOTHESIS_THRESHOLD).toBe(8);
  });

  it('returns nothing when there is no target role to build from', () => {
    expect(buildOnboardingRoleCards({ experience: [] })).toEqual([]);
  });
});
