import { OnboardingWizardView } from './OnboardingWizardView';
import { type OnboardingWizardProps } from './onboardingWizardTypes';
import { useOnboardingWizardModel } from './useOnboardingWizardModel';

export type { OnboardingWizardProps } from './onboardingWizardTypes';

export function OnboardingWizard(props: OnboardingWizardProps) {
  const model = useOnboardingWizardModel(props);
  return <OnboardingWizardView model={model} />;
}
