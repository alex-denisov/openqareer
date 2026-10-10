import { ArrowRight, CheckCircle, Clock } from '@phosphor-icons/react';
import type { RoleSkillAssessmentMutationResult } from './roleSkillAssessmentApi';
import { EvaluationDetails } from './RoleSkillAssessmentCaseViews';

type AssessmentRun = RoleSkillAssessmentMutationResult['run'];
const GRADE_LABELS = {
  confirmed: 'Подтверждено',
  partial: 'Частично подтверждено',
  not_confirmed: 'Не подтверждено',
} as const;

export function ResultState(props: {
  run: AssessmentRun;
  stale: boolean;
  consent: boolean;
  busy: boolean;
  reviewingCase?: boolean;
  onConsent: (value: boolean) => void;
  onRefresh: () => void;
  onOpenOpportunities: () => void;
  onReviewCase: (caseId: string) => void;
}) {
  return (
    <section className="career-role-assessment-results">
      {props.stale ? <StaleNotice /> : null}
      <ResultSummary {...props} openRole={props.run.readiness.ready} />
      <div className="career-role-assessment-skill-results">
        {props.run.skills.map((skill) => (
          <SkillResultCard
            key={skill.id}
            run={props.run}
            skill={skill}
            onReviewCase={props.onReviewCase}
          />
        ))}
      </div>
      <ResultSource run={props.run} />
    </section>
  );
}

function StaleNotice() {
  return (
    <div className="career-role-assessment-stale" role="status">
      <Clock size={18} aria-hidden="true" />
      <p>
        Результат устарел. Сверка требований была больше 90 дней назад. Освежите навыки по текущим
        вакансиям роли.
      </p>
    </div>
  );
}

function ResultSummary(props: Parameters<typeof ResultState>[0] & { openRole: boolean }) {
  return (
    <div className="career-role-assessment-card career-role-assessment-result-summary">
      <span className="career-role-assessment-tag">Итог по роли</span>
      <h2>{props.openRole ? 'Ключевые навыки подтверждены' : 'Роль пока не открылась'}</h2>
      <p>
        {props.run.readiness.confirmedCount} из 5 навыков подтверждены.{' '}
        {resultExplanation(props.run.readiness.missingKeySkillIds, props.openRole)}
      </p>
      <label className="career-role-assessment-consent">
        <input
          type="checkbox"
          checked={props.consent}
          onChange={(event) => props.onConsent(event.currentTarget.checked)}
        />
        <span>Согласен передать ответы модели для новой проверки.</span>
      </label>
      {!props.reviewingCase ? <ResultActions {...props} /> : null}
    </div>
  );
}

function resultExplanation(missingKeySkillIds: readonly string[], openRole: boolean): string {
  if (openRole) return 'Можно перейти к вакансиям по этой роли.';
  return missingKeySkillIds.length
    ? 'Не все ключевые навыки подтверждены.'
    : 'Нужно ещё подтверждение по итоговым критериям.';
}

function ResultActions(props: Parameters<typeof ResultState>[0] & { openRole: boolean }) {
  const refreshButton = (
    <button
      className={props.openRole ? 'career-quiet-button' : 'career-primary-button'}
      type="button"
      disabled={props.busy || !props.consent}
      onClick={props.onRefresh}
    >
      Освежить навыки
    </button>
  );
  const roleButton = props.openRole ? (
    <button className="career-primary-button" type="button" onClick={props.onOpenOpportunities}>
      К вакансиям по роли <ArrowRight size={16} aria-hidden="true" />
    </button>
  ) : null;
  return (
    <div className="career-role-assessment-actions">
      {roleButton}
      {refreshButton}
    </div>
  );
}

function SkillResultCard({
  run,
  skill,
  onReviewCase,
}: {
  run: AssessmentRun;
  skill: AssessmentRun['skills'][number];
  onReviewCase: (caseId: string) => void;
}) {
  const caseRecord = run.cases.find((item) => item.assessmentCase.skillId === skill.id);
  const untested = !caseRecord || caseRecord.status === 'skipped';
  return (
    <article className="career-role-assessment-card">
      <span className={`career-role-assessment-grade is-${untested ? 'untested' : skill.grade}`}>
        <CheckCircle size={17} aria-hidden="true" />
        <strong>{untested ? 'Не проверено' : GRADE_LABELS[skill.grade]}</strong>
      </span>
      <h3>{skill.name}</h3>
      {skill.isKeySkill ? <span className="career-role-assessment-tag">Ключевой навык</span> : null}
      <p>{skillExplanation(skill.explanation, caseRecord?.status)}</p>
      {caseRecord?.evaluation ? (
        <SkillResultDetails
          run={run}
          caseId={caseRecord.assessmentCase.id}
          onReviewCase={onReviewCase}
        />
      ) : null}
    </article>
  );
}

function skillExplanation(explanation: string, status?: string): string {
  if (status === 'skipped') return 'Кейс пропущен; это не означает отсутствия опыта.';
  if (status === undefined) return 'В этой проверке кейс для навыка не проводился.';
  return explanation;
}

function SkillResultDetails({
  run,
  caseId,
  onReviewCase,
}: {
  run: AssessmentRun;
  caseId: string;
  onReviewCase: (caseId: string) => void;
}) {
  const record = run.cases.find((item) => item.assessmentCase.id === caseId);
  if (!record?.evaluation) return null;
  return (
    <>
      <details>
        <summary>Почему так</summary>
        <EvaluationDetails evaluation={record.evaluation} />
      </details>
      <button type="button" className="career-quiet-button" onClick={() => onReviewCase(caseId)}>
        Разобрать кейс
      </button>
    </>
  );
}

function ResultSource({ run }: { run: AssessmentRun }) {
  return (
    <p className="career-role-assessment-meta">
      Вакансии в выборке: {run.sampleSize} · требования обновлены{' '}
      {formatDate(run.evidenceObservedAt)}.
    </p>
  );
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }).format(
        date,
      )
    : 'дата не указана';
}
