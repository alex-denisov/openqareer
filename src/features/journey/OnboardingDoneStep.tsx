interface OnboardingDoneStepProps {
  readonly roleTitle?: string;
  readonly durationLabel: string;
}

/**
 * Step 6, "Первая подборка готова" (onboarding.html). The mockup also shows
 * a live vacancy count, "новых сегодня" and a second role's count — those
 * numbers come from the campaign/pool the candidate is about to open, which
 * is not read from this screen (mockup-data-gap.md, "Онбординг" §Шаг 6); a
 * "считается" row says so honestly instead of repeating the mockup's sample
 * figures as if they were real.
 */
export function OnboardingDoneStep(props: OnboardingDoneStepProps) {
  return (
    <div className="career-onboarding-done-summary">
      <p className="career-eyebrow">
        {props.durationLabel} с начала
      </p>
      <div className="career-onboarding-done-row">
        <span>Роль кампании</span>
        <strong className="metric">{props.roleTitle ?? 'Роль ещё не выбрана'}</strong>
      </div>
      <div className="career-onboarding-done-row">
        <span>Вакансий в подборке</span>
        <strong className="metric">считается — откроется в «Вакансии»</strong>
      </div>
    </div>
  );
}
