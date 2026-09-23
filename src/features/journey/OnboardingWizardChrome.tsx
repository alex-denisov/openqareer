import type { OnboardingStepInfo } from './onboardingWizardSteps';

interface OnboardingWizardChromeProps {
  readonly step: OnboardingStepInfo;
  readonly title: string;
  readonly description: string;
  readonly onSkip: () => void;
}

/**
 * The dots, eyebrow and title every step of onboarding.html shares. The
 * mockup always shows six dots regardless of branch (`onboardingWizardSteps`
 * fixes the slot count), and "Отложить настройку" is the one way out on
 * every step, not just the first.
 */
export function OnboardingWizardChrome(props: OnboardingWizardChromeProps) {
  const dots = Array.from({ length: props.step.total }, (_, index) => index + 1);
  return (
    <header className="career-onboarding-header">
      {/* The shell's own rail already carries the wordmark (`BrandMark`); a
          second one here only spent vertical space onboarding.html does not
          have to share with the rest of the app's chrome. */}
      <div className="career-onboarding-top">
        <button type="button" className="career-quiet-button" onClick={props.onSkip}>
          Отложить настройку
        </button>
      </div>
      <ol className="career-onboarding-dots" aria-hidden="true">
        {dots.map((dot) => (
          <li
            key={dot}
            className={
              dot < props.step.dot ? 'is-done' : dot === props.step.dot ? 'is-current' : ''
            }
          />
        ))}
      </ol>
      <p className="career-eyebrow">
        Шаг {props.step.dot} из {props.step.total}
      </p>
      <h1>{props.title}</h1>
      <p className="career-lead">{props.description}</p>
    </header>
  );
}
