import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ApplicationQuestionnaire,
  QuestionnaireQuestion,
  QuestionnaireSuggestion,
} from '../../../../shared/applicationQuestionnaire';
import { hhFormUrl, type HhForm } from '../../../../shared/hhCandidateSession';
import { QUESTIONNAIRE_ANSWER_MAX_LENGTH } from '../../../../shared/applicationQuestionnaire';
import { apiErrorMessage } from '../../coach/apiClient';
import { Button, InfoTip, ResultLine, StatusLine, useToast } from '../kit';
import { useAsync } from '../responses/data/useAsync';
import { ChoiceField } from './ChoiceField';
import {
  getQuestionnaire,
  markQuestionnaireSubmitted,
  saveHhForm,
  saveQuestionnaireAnswers,
} from './data/questionnaireApi';
import {
  answerOf,
  answersOf,
  copyText,
  draftOf,
  readiness,
  readinessTitle,
  type AnswerDraft,
  type FormReadiness,
} from './model/formModel';

type Mark =
  | { readonly kind: 'idle' | 'busy' | 'done' }
  | { readonly kind: 'error'; readonly text: string };

export interface QuestionnaireState {
  /** Анкета с вопросами; `null` — её нет или вопросы заранее не читаются. */
  readonly form: ApplicationQuestionnaire | null;
  /** Название и компания вакансии, как их знает сервер. */
  readonly known: { readonly vacancyTitle: string; readonly companyName: string } | null;
  readonly draft: AnswerDraft;
  readonly setAnswer: (questionId: string, text: string) => void;
  /** Сохранить ответы: при уходе из поля, после выбора и перед копированием. */
  readonly save: (next?: AnswerDraft) => void;
  readonly saveError: string | null;
  readonly submitted: Mark;
  readonly markSubmitted: () => void;
  /** Анкета hh.ru прочитана в окне кандидата; `false` — вопросов нет или они не сохранились. */
  readonly takeHhForm: (form: HhForm) => Promise<boolean>;
}

/** Анкета работодателя по вакансии: загрузка, черновик ответов и их сохранение. */
export function useQuestionnaire(vacancyId: string): QuestionnaireState {
  const load = useCallback((signal: AbortSignal) => getQuestionnaire(vacancyId, signal), [vacancyId]);
  const { state, replaceData } = useAsync(load, '');
  const data = state.data;
  const form = data?.state === 'ready' ? data : null;
  const [draft, setDraft] = useState<AnswerDraft>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<Mark>({ kind: 'idle' });
  // Сохранения идут по одному: поздний ответ сервера не затирает более свежий набор.
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  useEffect(() => {
    if (form) setDraft(draftOf(form));
  }, [form]);

  const title = data?.vacancyTitle;
  return {
    form,
    known: title ? { vacancyTitle: title, companyName: data?.vacancyCompany ?? '' } : null,
    draft,
    saveError,
    submitted: form?.submittedAt && submitted.kind === 'idle' ? { kind: 'done' } : submitted,
    setAnswer: (questionId, text) => setDraft((current) => ({ ...current, [questionId]: text })),
    save: (next = draft) => {
      queue.current = queue.current
        .then(() => saveQuestionnaireAnswers(vacancyId, answersOf(next)))
        .then(() => setSaveError(null))
        .catch((reason: unknown) =>
          setSaveError(apiErrorMessage(reason, 'Ответы не сохранились. Повторите.')),
        );
    },
    markSubmitted: () => {
      setSubmitted({ kind: 'busy' });
      markQuestionnaireSubmitted(vacancyId)
        .then(() => setSubmitted({ kind: 'done' }))
        .catch((reason: unknown) =>
          setSubmitted({ kind: 'error', text: apiErrorMessage(reason, 'Отметка не сохранилась.') }),
        );
    },
    takeHhForm: async (hhForm) => {
      if (hhForm.questions.length === 0) return false;
      try {
        // Ответы, которые ещё сохраняются, сначала доходят до сервера.
        await queue.current;
        const next = await saveHhForm(vacancyId, hhForm);
        replaceData(next);
        return next.state === 'ready';
      } catch {
        return false;
      }
    },
  };
}

interface AnswerFieldProps {
  readonly fieldId: string;
  readonly question: QuestionnaireQuestion;
  readonly value: string;
  readonly state: QuestionnaireState;
}

function isChoice(question: QuestionnaireQuestion): boolean {
  return question.kind === 'choice' && Boolean(question.options?.length);
}

/** Поле ответа: у вопроса с вариантами — выбор из них, иначе свободный текст. */
function AnswerField({ fieldId, question, value, state }: AnswerFieldProps) {
  if (isChoice(question)) {
    const pick = (next: string) => {
      state.setAnswer(question.id, next);
      state.save({ ...state.draft, [question.id]: next });
    };
    return <ChoiceField fieldId={fieldId} question={question} value={value} onPick={pick} />;
  }
  return (
    <textarea
      id={fieldId}
      rows={2}
      placeholder="Ваш ответ"
      maxLength={QUESTIONNAIRE_ANSWER_MAX_LENGTH}
      value={value}
      onChange={(event) => state.setAnswer(question.id, event.currentTarget.value)}
      onBlur={() => state.save()}
    />
  );
}

interface QuestionProps {
  readonly question: QuestionnaireQuestion;
  readonly suggestion: QuestionnaireSuggestion | undefined;
  readonly state: QuestionnaireState;
}

function Question({ question, suggestion, state }: QuestionProps) {
  const fieldId = `qa-${question.id}`;
  const value = answerOf(state.draft, question.id);
  return (
    <li className="qa">
      <div className="qa-q">
        <span>{question.text}</span>
        {suggestion && value === suggestion.text ? (
          <InfoTip label="Откуда ответ" text={`${suggestion.source}: ${suggestion.text}`} />
        ) : null}
        {question.required ? null : <span className="tag src">необязательный</span>}
      </div>
      <div className="field">
        {/* У вопроса с выбором название несёт сама группа вариантов. */}
        {isChoice(question) ? null : (
          <label className="vh" htmlFor={fieldId}>
            {`Ваш ответ: ${question.text}`}
          </label>
        )}
        <AnswerField fieldId={fieldId} question={question} value={value} state={state} />
      </div>
    </li>
  );
}

interface ActionsProps {
  readonly form: ApplicationQuestionnaire;
  readonly ready: FormReadiness;
  readonly state: QuestionnaireState;
}

/** Переводит к полю вопроса: прокрутка и фокус, без смены адреса. */
function focusField(fieldId: string): void {
  const field = document.getElementById(fieldId);
  field?.scrollIntoView({ block: 'center' });
  field?.focus();
}

/** Главное действие анкеты: дойти до пропущенного обязательного вопроса или скопировать ответы. */
function FormActions({ form, ready, state }: ActionsProps) {
  const toast = useToast();
  const copy = () => {
    state.save();
    const failed = () => toast.show({ text: 'Не получилось скопировать' });
    try {
      void navigator.clipboard
        .writeText(copyText(form.questions, state.draft))
        .then(() => toast.show({ text: 'Ответы скопированы' }))
        .catch(failed);
    } catch {
      failed();
    }
  };
  return (
    <>
      {ready.nextRequired ? (
        <Button variant="primary" icon="edit" onClick={() => focusField(`qa-${ready.nextRequired?.id}`)}>
          {`Ответьте на обязательные · ${ready.missingRequired}`}
        </Button>
      ) : (
        <Button variant="primary" icon="copy" disabled={ready.answered === 0} onClick={copy}>
          Скопировать ответы
        </Button>
      )}
      {form.formUrl ? (
        <a className="row-act" href={form.formUrl} target="_blank" rel="noopener noreferrer">
          Анкета на сайте ↗
        </a>
      ) : null}
    </>
  );
}

function SubmittedBlock({ state, onHh }: { readonly state: QuestionnaireState; readonly onHh: boolean }) {
  const mark = state.submitted;
  return (
    <section className="mod" aria-labelledby="qb-back">
      <h3 className="mod-title" id="qb-back">
        {onHh ? 'Вернулись с hh.ru?' : 'Вернулись с сайта компании?'}
      </h3>
      {mark.kind === 'done' ? (
        <ResultLine text="Анкета отмечена как отправленная" />
      ) : (
        <div className="actions">
          <Button variant="quiet" icon="check" busy={mark.kind === 'busy'} onClick={state.markSubmitted}>
            Анкета отправлена
          </Button>
        </div>
      )}
      {mark.kind === 'error' ? <StatusLine state="err" text={mark.text} /> : null}
    </section>
  );
}

export interface FormStepProps {
  readonly state: QuestionnaireState;
  readonly form: ApplicationQuestionnaire;
}

/** Шаг «Анкета» (O4b): вопросы работодателя, ответы кандидата и переход на страницу анкеты. */
export function FormStep({ state, form }: FormStepProps) {
  const ready = readiness(form.questions, state.draft);
  const suggestions = new Map(form.suggestions.map((item) => [item.questionId, item]));
  return (
    <>
      <div className="col">
        <section className="lead" aria-labelledby="qb-title">
          <h2 className="lead-title is-long" id="qb-title">
            {readinessTitle(ready)}
          </h2>
          <ul>
            {form.questions.map((question) => (
              <Question
                key={question.id}
                question={question}
                suggestion={suggestions.get(question.id)}
                state={state}
              />
            ))}
          </ul>
          {state.saveError ? <StatusLine state="err" text={state.saveError} /> : null}
          <div className="actions m-commit qa-mob">
            <FormActions form={form} ready={ready} state={state} />
          </div>
        </section>
      </div>
      <div className="col">
        <aside className="qa-side" aria-label="Готовность анкеты">
          <p className="qa-count">
            <b className="num">{`${ready.answered} из ${ready.total}`}</b> готовы
          </p>
          <div className="actions">
            <FormActions form={form} ready={ready} state={state} />
          </div>
        </aside>
        <SubmittedBlock state={state} onHh={Boolean(form.formUrl && hhFormUrl(form.formUrl))} />
      </div>
    </>
  );
}
