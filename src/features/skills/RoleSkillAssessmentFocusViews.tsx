import type { SkillCheckFocus } from '../vacancies/VacancyQuizProposal';
import type { RoleSkillAssessmentCurrent } from './roleSkillAssessmentApi';
import { getAssessmentRun } from './roleSkillAssessmentState';
import { EmptyState, StartAction } from './RoleSkillAssessmentStartViews';

type Run = NonNullable<ReturnType<typeof getAssessmentRun>>;

/** The run belongs to this vacancy offer: same vacancy and the same skills. */
export function runMatchesFocus(run: Run | undefined, focus: SkillCheckFocus): boolean {
  return Boolean(
    run?.focus &&
    run.focus.vacancyId === focus.vacancyId &&
    run.focus.skills.length === focus.skills.length &&
    focus.skills.every((skill) =>
      run.focus!.skills.some(
        (item) => item.toLocaleLowerCase('ru') === skill.toLocaleLowerCase('ru'),
      ),
    ),
  );
}

/** What the check is for, plus the honest notes the server returned (B552). */
export function SkillCheckFocusNote({ focus, run }: { focus: SkillCheckFocus; run?: Run }) {
  const stored = run && runMatchesFocus(run, focus) ? run.focus : undefined;
  return (
    <div className="career-role-assessment-focus">
      <p>
        Из вакансии «{focus.roleTitle}»: подтвердить {focus.skills.join(' и ')}. Результат попадёт в
        профиль, соответствие вакансии пересчитается.
      </p>
      {stored?.roleNote ? <p>{stored.roleNote}</p> : null}
      {stored?.lackingNotes.map((note) => (
        <p key={note}>{note}</p>
      ))}
    </div>
  );
}

export function FocusInsufficientState({
  current,
  onClose,
}: {
  current: Extract<RoleSkillAssessmentCurrent, { state: 'focus_insufficient' }>;
  onClose: () => void;
}) {
  return (
    <EmptyState
      title={`Мало данных по ${current.skills.join(' и ')}`}
      text={`${current.notes.join(' ')} Кейсы по одной вакансии не строим: оценка была бы недостоверной.`}
      action="Вернуться к вакансии"
      onAction={onClose}
    />
  );
}

/** A previous check is on screen; the offer starts a new one for these skills. */
export function FocusStartCard({
  focus,
  consent,
  busy,
  onConsent,
  onStart,
  onLater,
}: {
  focus: SkillCheckFocus;
  consent: boolean;
  busy: boolean;
  onConsent: (value: boolean) => void;
  onStart: () => void;
  onLater: () => void;
}) {
  return (
    <section className="career-role-assessment-card career-role-assessment-intro">
      <h2>Проверка по {focus.skills.join(' и ')}</h2>
      <p className="career-role-assessment-lead">
        Около 20 минут: короткий диалог и кейсы по этим навыкам из вакансий роли.
      </p>
      <label className="career-role-assessment-consent">
        <input
          type="checkbox"
          checked={consent}
          onChange={(event) => onConsent(event.currentTarget.checked)}
        />
        <span>Согласен передать ответы модели для проверки по критериям.</span>
      </label>
      <StartAction consent={consent} busy={busy} onStart={onStart} onLater={onLater} />
    </section>
  );
}
