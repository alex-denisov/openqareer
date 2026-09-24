import { describe, expect, it } from 'vitest';
import {
  nextStep,
  previousStep,
  stepInfo,
  stepsForBranch,
  type OnboardingBranch,
} from './onboardingWizardSteps';

describe('onboardingWizardSteps', () => {
  it('lists the file/LinkedIn/hh branch as six steps, live progress in slot 2', () => {
    expect(stepsForBranch('file')).toEqual([
      'source',
      'progress',
      'review',
      'roles',
      'geo',
      'done',
    ]);
  });

  it('lists the talk branch with the three-question step in the same slot 2', () => {
    expect(stepsForBranch('talk')).toEqual([
      'source',
      'talk',
      'review',
      'roles',
      'geo',
      'done',
    ]);
  });

  it.each<[OnboardingBranch, string, number]>([
    ['file', 'source', 1],
    ['file', 'progress', 2],
    ['file', 'review', 3],
    ['file', 'roles', 4],
    ['file', 'geo', 5],
    ['file', 'done', 6],
    ['talk', 'talk', 2],
  ])('reports dot %i for %s on the %s branch', (branch, id, dot) => {
    expect(stepInfo(branch, id as never).dot).toBe(dot);
    expect(stepInfo(branch, id as never).total).toBe(6);
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
