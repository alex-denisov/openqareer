export interface OnboardingTalkValues {
  readonly tasks: string;
  readonly change: string;
  readonly successMeasure: string;
}

interface OnboardingTalkStepProps extends OnboardingTalkValues {
  readonly onChange: (patch: Partial<OnboardingTalkValues>) => void;
}

/**
 * Step 2b, "Три вопроса о последней роли" — the "расскажу сам" branch
 * (onboarding.html). Tasks first, not job titles: a title without the tasks
 * behind it tells the wizard nothing that transfers to a new role.
 */
export function OnboardingTalkStep(props: OnboardingTalkStepProps) {
  return (
    <div className="career-onboarding-qa-list">
      <label className="career-onboarding-qa-item">
        <span>
          Что вы реально делали на последнем месте — на уровне задач, не должности
        </span>
        <textarea
          value={props.tasks}
          onChange={(event) => props.onChange({ tasks: event.target.value })}
          placeholder="Например: вёл переговоры с 12 поставщиками, отвечал за бюджет отдела…"
          rows={3}
        />
      </label>
      <label className="career-onboarding-qa-item">
        <span>Что хочется изменить в следующей роли</span>
        <textarea
          value={props.change}
          onChange={(event) => props.onChange({ change: event.target.value })}
          placeholder="Например: меньше операционки, больше стратегии"
          rows={3}
        />
      </label>
      <label className="career-onboarding-qa-item">
        <span>Какой результат через год вы сочтёте успехом</span>
        <textarea
          value={props.successMeasure}
          onChange={(event) => props.onChange({ successMeasure: event.target.value })}
          rows={3}
        />
      </label>
    </div>
  );
}
