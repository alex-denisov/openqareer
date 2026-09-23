/**
 * Step order for the redesigned onboarding wizard (B248 macro layout,
 * B249 slice). The mockup fixes six dots regardless of branch: the "tell it
 * myself" branch swaps the live-parse-progress screen (slot 2) for three
 * structured questions, everything else stays in the same place
 * (docs/v1-release/tasks/work/B248/onboarding.html).
 */
export type OnboardingBranch = 'file' | 'talk';

export type OnboardingStepId =
  | 'source'
  | 'progress'
  | 'talk'
  | 'review'
  | 'roles'
  | 'geo'
  | 'done';

export interface OnboardingStepInfo {
  readonly id: OnboardingStepId;
  /** 1-based position among the six dots the mockup always shows. */
  readonly dot: number;
  readonly total: 6;
}

const STEP_ORDER: Readonly<Record<OnboardingBranch, readonly OnboardingStepId[]>> = {
  file: ['source', 'progress', 'review', 'roles', 'geo', 'done'],
  talk: ['source', 'talk', 'review', 'roles', 'geo', 'done'],
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
  return { id, dot: index + 1, total: 6 };
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
