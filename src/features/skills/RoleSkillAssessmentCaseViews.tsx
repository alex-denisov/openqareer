import { useState, type FormEvent, type RefObject } from 'react';
import { ArrowRight, CheckCircle, WarningCircle } from '@phosphor-icons/react';
import { VoiceInput } from '../coach/VoiceInput';
import type { VoiceInputState } from '../coach/voiceInputMachine';
import type { RoleSkillAssessmentMutationResult } from './roleSkillAssessmentApi';
import { criterionLabel } from './roleSkillLabels';

type AssessmentRun = RoleSkillAssessmentMutationResult['run'];
type CaseRecord = AssessmentRun['cases'][number];

const GRADE_LABELS = {
  confirmed: 'Подтверждено',
  partial: 'Частично подтверждено',
  not_confirmed: 'Не подтверждено',
} as const;

interface CaseStateProps {
  run: AssessmentRun;
  activeCase: CaseRecord;
  answer: string;
  dirty: boolean;
  editing: boolean;
  discussionOpen: boolean;
  discussionQuestion: string;
  appealOpen: boolean;
  appealReason: string;
  busy: boolean;
  onAnswerChange: (value: string) => void;
  onSubmitCase: () => void;
  onVoiceSubmit: (value: string) => Promise<boolean>;
  onSkip: () => void;
  onEdit: () => void;
  onCancelEdit: () => void;
  onContinue: () => void;
  onCloseReview: () => void;
  onDiscussionOpen: () => void;
  onDiscussionChange: (value: string) => void;
  onDiscuss: (event: FormEvent<HTMLFormElement>) => void;
  onAppealOpen: () => void;
  onAppealChange: (value: string) => void;
  onAppeal: (event: FormEvent<HTMLFormElement>) => void;
  inputRef: RefObject<HTMLTextAreaElement>;
}

export function CaseState(props: CaseStateProps) {
  const record = props.activeCase;
  const caseIndex = props.run.cases.findIndex(
    (item) => item.assessmentCase.id === record.assessmentCase.id,
  );
  const canContinue =
    props.run.status === 'cases' && caseIndex >= 0 && caseIndex < props.run.currentCaseIndex;
  return (
    <section
      className={`career-role-assessment-card career-role-assessment-case${props.run.status === 'complete' ? ' is-skill-detail' : ''}`}
    >
      <CaseHeading run={props.run} record={record} caseIndex={caseIndex} />
      <CasePrompt record={record} />
      <DiscussionHistory record={record} />
      {record.evaluation ? <EvaluationDetails evaluation={record.evaluation} /> : null}
      {record.status === 'pending' || props.editing ? <CaseAnswerForm {...props} /> : null}
      <CaseActions {...props} canContinue={canContinue} />
      {props.discussionOpen ? (
        <DiscussionForm
          busy={props.busy}
          question={props.discussionQuestion}
          onChange={props.onDiscussionChange}
          onSubmit={props.onDiscuss}
        />
      ) : null}
      {props.appealOpen ? (
        <AppealForm
          busy={props.busy}
          reason={props.appealReason}
          onChange={props.onAppealChange}
          onSubmit={props.onAppeal}
        />
      ) : null}
      <CaseSource record={record} />
    </section>
  );
}

function CaseHeading({
  run,
  record,
  caseIndex,
}: {
  run: AssessmentRun;
  record: CaseRecord;
  caseIndex: number;
}) {
  return (
    <div className="career-role-assessment-card-heading">
      <div>
        <span className="career-role-assessment-tag">
          Кейс {caseIndex + 1} из {run.cases.length}
        </span>
        <h2>{record.assessmentCase.skillName}</h2>
      </div>
      <span className="career-role-assessment-meta">
        {record.assessmentCase.requirementsCount} вакансий
      </span>
    </div>
  );
}

function CasePrompt({ record }: { record: CaseRecord }) {
  return (
    <div className="career-role-assessment-case-prompt">
      <p>{record.assessmentCase.prompt}</p>
      <span>
        Основано на повторяющихся требованиях вакансий роли. Отвечайте на реальном примере.
      </span>
    </div>
  );
}

function DiscussionHistory({ record }: { record: CaseRecord }) {
  if (!record.discussion.length) return null;
  return (
    <div className="career-role-assessment-discussion-history">
      {record.discussion.map((item, index) => (
        <article key={`${item.createdAt}-${index}`}>
          <strong>Уточнение</strong>
          <p>{item.question}</p>
          <strong>Ответ консультанта</strong>
          <p>{item.answer}</p>
        </article>
      ))}
    </div>
  );
}

function CaseAnswerForm(props: CaseStateProps) {
  return (
    <form className="career-role-assessment-composer" onSubmit={submitCase(props.onSubmitCase)}>
      <label className="career-role-assessment-sr-only" htmlFor="role-assessment-case-answer">
        Ваш ответ на кейс
      </label>
      <textarea
        ref={props.inputRef}
        id="role-assessment-case-answer"
        value={props.answer}
        onChange={(event) => props.onAnswerChange(event.currentTarget.value)}
        placeholder="Опишите ситуацию, ваши действия и результат…"
        rows={5}
        maxLength={10000}
        disabled={props.busy}
      />
      <CaseComposerActions {...props} />
    </form>
  );
}

function submitCase(onSubmit: () => void) {
  return (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmit();
  };
}

function CaseComposerActions(props: CaseStateProps) {
  const record = props.activeCase;
  const buttonText = props.busy
    ? 'Проверяем…'
    : record.evaluation
      ? 'Дополнить и переоценить'
      : 'Пройти кейс';
  const [voiceState, setVoiceState] = useState<VoiceInputState>('idle');
  return (
    <div className="career-role-assessment-composer-actions">
      <VoiceInput
        value={props.answer}
        disabled={props.busy}
        onChange={props.onAnswerChange}
        onStateChange={setVoiceState}
        onVoiceDraftChange={() => undefined}
        onSubmitVoice={props.onVoiceSubmit}
        onTextMode={() => props.inputRef.current?.focus()}
      />
      <span>
        {props.answer.length}/10000{props.dirty ? ' · сохраняем черновик' : ''}
      </span>
      {props.answer.trim() && voiceState === 'idle' ? (
        <button className="career-primary-button" type="submit" disabled={props.busy}>
          {buttonText} <ArrowRight size={16} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}

function CaseActions({ ...props }: CaseStateProps & { canContinue: boolean }) {
  const record = props.activeCase;
  if (record.status === 'pending') return <PendingCaseActions {...props} />;
  if (!record.evaluation) return null;
  if (props.editing)
    return (
      <button
        className="career-quiet-button"
        type="button"
        disabled={props.busy}
        onClick={props.onCancelEdit}
      >
        Отменить дополнение
      </button>
    );
  return <EvaluatedCaseActions {...props} />;
}

function PendingCaseActions(props: CaseStateProps) {
  return (
    <div className="career-role-assessment-actions">
      <button
        className="career-quiet-button"
        type="button"
        disabled={props.busy || props.dirty}
        onClick={props.onSkip}
      >
        Пропустить кейс
      </button>
      <button
        className="career-quiet-button"
        type="button"
        disabled={props.busy}
        onClick={props.onDiscussionOpen}
      >
        Обсудить условие
      </button>
    </div>
  );
}

function EvaluatedCaseActions(props: CaseStateProps & { canContinue: boolean }) {
  return (
    <div className="career-role-assessment-actions">
      <button
        className="career-quiet-button"
        type="button"
        disabled={props.busy}
        onClick={props.onEdit}
      >
        Дополнить ответ
      </button>
      <button
        className="career-quiet-button"
        type="button"
        disabled={props.busy}
        onClick={props.onAppealOpen}
      >
        Оспорить оценку
      </button>
      {props.canContinue ? (
        <button
          className="career-primary-button"
          type="button"
          disabled={props.busy}
          onClick={props.onContinue}
        >
          Перейти к следующему кейсу <ArrowRight size={16} aria-hidden="true" />
        </button>
      ) : null}
      {props.run.status === 'complete' ? (
        <button className="career-quiet-button" type="button" onClick={props.onCloseReview}>
          К итогу
        </button>
      ) : null}
    </div>
  );
}

function DiscussionForm({
  busy,
  question,
  onChange,
  onSubmit,
}: {
  busy: boolean;
  question: string;
  onChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <form className="career-role-assessment-inline-form" onSubmit={onSubmit}>
      <label htmlFor="role-assessment-discussion">Что уточнить в условии?</label>
      <textarea
        id="role-assessment-discussion"
        value={question}
        onChange={(event) => onChange(event.currentTarget.value)}
        rows={2}
        maxLength={2000}
      />
      <button className="career-quiet-button" type="submit" disabled={!question.trim() || busy}>
        {busy ? 'Отправляем…' : 'Обсудить условие'}
      </button>
    </form>
  );
}

function AppealForm({
  busy,
  reason,
  onChange,
  onSubmit,
}: {
  busy: boolean;
  reason: string;
  onChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <form className="career-role-assessment-inline-form" onSubmit={onSubmit}>
      <label htmlFor="role-assessment-appeal">Что не учтено в оценке?</label>
      <textarea
        id="role-assessment-appeal"
        value={reason}
        onChange={(event) => onChange(event.currentTarget.value)}
        rows={2}
        maxLength={2000}
      />
      <button className="career-quiet-button" type="submit" disabled={!reason.trim() || busy}>
        {busy ? 'Перепроверяем…' : 'Оспорить оценку'}
      </button>
    </form>
  );
}

function CaseSource({ record }: { record: CaseRecord }) {
  return (
    <p className="career-role-assessment-case-source">
      Источники: {record.assessmentCase.sourceRefs.length} датированных упоминаний в вакансиях.
      Пропуск оставляет навык непроверенным.
    </p>
  );
}

export function EvaluationDetails({
  evaluation,
}: {
  evaluation: AssessmentRun['cases'][number]['evaluation'];
}) {
  if (!evaluation) return null;
  return (
    <section className="career-role-assessment-evaluation">
      <EvaluationGrade grade={evaluation.grade} />
      <h3>Почему так</h3>
      {evaluation.criteria.map((criterion) => (
        <article key={criterion.criterionId}>
          <strong>
            {criterionLabel(criterion.criterionId)} · {GRADE_LABELS[criterion.grade]}
          </strong>
          <p>{criterion.explanation}</p>
          <blockquote>{criterion.candidateExcerpt}</blockquote>
        </article>
      ))}
    </section>
  );
}

function EvaluationGrade({ grade }: { grade: keyof typeof GRADE_LABELS }) {
  return (
    <div className={`career-role-assessment-grade is-${grade}`}>
      <CheckCircle size={18} aria-hidden="true" />
      <strong>{GRADE_LABELS[grade]}</strong>
    </div>
  );
}

export function ModelErrorState({
  run,
  busy,
  onRetry,
  onSkipSuggestions,
}: {
  run: AssessmentRun;
  busy: boolean;
  onRetry: () => void;
  /** B564: the suggestion step is optional, so a failed one must not block the cases. */
  onSkipSuggestions?: () => void;
}) {
  const suggestionStep = run.modelError?.action === 'suggestions';
  return (
    <section className="career-role-assessment-state" role="alert">
      <WarningCircle size={24} aria-hidden="true" />
      <h2>Модель не завершила проверку</h2>
      <p>
        {suggestionStep
          ? 'Не удалось подготовить предложения в профиль. Ответы сохранены, ничего не потеряно. Повторите шаг или переходите к кейсам: профиль останется без изменений.'
          : 'Ответ не оценён: модель не ответила. Ваш текст и шаги сохранены, ничего не потеряно. Повторите этот шаг, когда сервис будет доступен.'}
      </p>
      <div className="career-role-assessment-actions">
        <button className="career-primary-button" type="button" disabled={busy} onClick={onRetry}>
          {busy ? 'Повторяем…' : 'Повторить шаг'}
        </button>
        {suggestionStep && onSkipSuggestions ? (
          <button
            className="career-quiet-button"
            type="button"
            disabled={busy}
            onClick={onSkipSuggestions}
          >
            Перейти к кейсам без предложений
          </button>
        ) : null}
      </div>
    </section>
  );
}
