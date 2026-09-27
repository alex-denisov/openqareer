import type { WorkspaceInput } from '../workspace/workspaceStorage';
import type { OnboardingTalkValues } from './OnboardingTalkStep';

export interface OnboardingWizardProps {
  readonly onComplete: (input: WorkspaceInput) => void;
  readonly hasAccount?: boolean;
  readonly onStartedChange?: (started: boolean) => void;
  readonly onSignIn?: () => void;
}

export const emptyTalk: OnboardingTalkValues = { tasks: '', change: '', successMeasure: '' };
