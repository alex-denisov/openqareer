/**
 * File intake gets one combined role-and-region confirmation screen. The
 * profileless branch stays short: role, region, then the first selection.
 */
export type OnboardingBranch = 'file' | 'talk';

export type OnboardingStepId = 'source' | 'progress' | 'talk' | 'review' | 'campaign' | 'done';

export interface OnboardingStepInfo {
  readonly id: OnboardingStepId;
  /** 1-based position in this branch's steps. */
  readonly dot: number;
  readonly total: number;
}

const STEP_ORDER: Readonly<Record<OnboardingBranch, readonly OnboardingStepId[]>> = {
  file: ['source', 'progress', 'review', 'campaign', 'done'],
  talk: ['source', 'talk', 'done'],
};

export function stepsForBranch(branch: OnboardingBranch): readonly OnboardingStepId[] {
  return STEP_ORDER[branch];
}

function indexOfStep(branch: OnboardingBranch, id: OnboardingStepId): number {
  return STEP_ORDER[branch].indexOf(id);
}

export function stepInfo(branch: OnboardingBranch, id: OnboardingStepId): OnboardingStepInfo {
  const index = indexOfStep(branch, id);
  if (index === -1) {
    throw new Error(`onboarding step "${id}" is not part of the "${branch}" branch`);
  }
  return { id, dot: index + 1, total: STEP_ORDER[branch].length };
}

export function nextStep(
  branch: OnboardingBranch,
  id: OnboardingStepId,
): OnboardingStepId | undefined {
  const order = STEP_ORDER[branch];
  const index = indexOfStep(branch, id);
  return index === -1 || index === order.length - 1 ? undefined : order[index + 1];
}

export function previousStep(
  branch: OnboardingBranch,
  id: OnboardingStepId,
): OnboardingStepId | undefined {
  const order = STEP_ORDER[branch];
  const index = indexOfStep(branch, id);
  return index <= 0 ? undefined : order[index - 1];
}
