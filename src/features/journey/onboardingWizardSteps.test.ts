import { describe, expect, it } from 'vitest';
import {
  nextStep,
  previousStep,
  stepInfo,
  stepsForBranch,
  type OnboardingBranch,
} from './onboardingWizardSteps';

describe('onboardingWizardSteps', () => {
  it('lists the file/LinkedIn/hh branch with one combined role and region step', () => {
    expect(stepsForBranch('file')).toEqual(['source', 'progress', 'review', 'campaign', 'done']);
  });

  it('keeps the profileless branch to a short role and region form', () => {
    expect(stepsForBranch('talk')).toEqual(['source', 'talk', 'done']);
  });

  it.each<[OnboardingBranch, string, number, number]>([
    ['file', 'source', 1, 5],
    ['file', 'progress', 2, 5],
    ['file', 'review', 3, 5],
    ['file', 'campaign', 4, 5],
    ['file', 'done', 5, 5],
    ['talk', 'source', 1, 3],
    ['talk', 'talk', 2, 3],
    ['talk', 'done', 3, 3],
  ])('reports dot %i for %s on the %s branch', (branch, id, dot, total) => {
    expect(stepInfo(branch, id as never).dot).toBe(dot);
    expect(stepInfo(branch, id as never).total).toBe(total);
  });

  it('refuses a step id that does not belong to the branch', () => {
    expect(() => stepInfo('file', 'talk')).toThrow();
    expect(() => stepInfo('talk', 'progress')).toThrow();
  });

  it('walks forward and backward inside a branch', () => {
    expect(nextStep('file', 'source')).toBe('progress');
    expect(nextStep('file', 'done')).toBeUndefined();
    expect(previousStep('file', 'review')).toBe('progress');
    expect(previousStep('file', 'source')).toBeUndefined();
    expect(nextStep('talk', 'source')).toBe('talk');
    expect(previousStep('talk', 'talk')).toBe('source');
  });
});
