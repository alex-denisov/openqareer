import { BrandMark } from '../brand/BrandMark';
import type { OnboardingStepInfo } from './onboardingWizardSteps';

interface OnboardingWizardChromeProps {
  readonly step: OnboardingStepInfo;
  readonly title: string;
  readonly description: string;
  readonly onSkip: () => void;
  /** Present only for an anonymous candidate: the rail and its account door
   *  are hidden for the whole wizard, step 1 included (owner, 2026-09-24). */
  readonly onSignIn?: () => void;
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
      {/* B249: onboarding.html is full-screen — the shell hides its own rail
          (and the wordmark it carried) for the whole diagnostic, so this is
          now the only sign on the screen. */}
      <div className="career-onboarding-top">
        <span className="career-onboarding-brand" aria-label="openqareer, главная">
          <BrandMark variant="lockup" size={26} />
        </span>
        <div className="career-onboarding-exits">
          {props.onSignIn ? (
            <button type="button" className="career-quiet-button" onClick={props.onSignIn}>
              Войти
            </button>
          ) : null}
          <button type="button" className="career-quiet-button" onClick={props.onSkip}>
            Отложить настройку
          </button>
        </div>
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
