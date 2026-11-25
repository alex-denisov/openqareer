import { useCallback, useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import type {
  ApplicationQuestionnaire,
  AtsFormInput,
  QuestionnaireQuestion,
  QuestionnaireSuggestion,
} from '../../../../shared/applicationQuestionnaire';
import { hhFormUrl, type HhForm } from '../../../../shared/hhCandidateSession';
import { QUESTIONNAIRE_ANSWER_MAX_LENGTH } from '../../../../shared/applicationQuestionnaire';
import { isTauriEnvironment } from '../../../services/desktop/desktopBridge';
import { apiErrorMessage } from '../../coach/apiClient';
import { Button, InfoTip, ResultLine, StatusLine, useIsMobile, useToast } from '../kit';
import { useAsync } from '../responses/data/useAsync';
import { VISIBILITY_QUESTION, type VisibilityState } from './visibilityQuestion';
import { ChoiceField } from './ChoiceField';
import {
  getQuestionnaire,
  markQuestionnaireSubmitted,
  saveAtsForm,
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
  { readonly kind: 'idle' | 'busy' | 'done' } | { readonly kind: 'error'; readonly text: string };

export interface QuestionnaireState {
  /** Анкета с вопросами; `null` — её нет или вопросы заранее не читаются. */
  readonly form: ApplicationQuestionnaire | null;
  /** Первое чтение анкеты ещё идёт. */
  readonly loading: boolean;
  /** Название и компания вакансии, как их знает сервер. */
  readonly known: { readonly vacancyTitle: string; readonly companyName: string } | null;
  readonly draft: AnswerDraft;
  readonly setAnswer: (questionId: string, text: string) => void;
  /** Сохранить ответы: при уходе из поля, после выбора и перед копированием. */
  readonly save: (next?: AnswerDraft) => void;
  readonly saveError: string | null;
  readonly submitted: Mark;
  readonly markSubmitted: () => void;
  /** Прочитать вопросы заново: их собрали в фоне (B787). */
  readonly reload: () => void;
  /** Анкета hh.ru прочитана в окне кандидата; `false` — вопросов нет или они не сохранились. */
  readonly takeHhForm: (form: HhForm) => Promise<boolean>;
  /**
   * Форма сайта работодателя прочитана приложением (B787). `stale` называет ответы, которых среди
   * вариантов уже нет: они стираются. `false` — вопросы не сохранились.
   */
  readonly takeAtsForm: (
    form: AtsFormInput,
    stale: (draft: AnswerDraft) => readonly string[],
  ) => Promise<boolean>;
}

/** Анкеты, прочитанные приложением на площадке, встают вопросами экрана. */
function formTakers(
  vacancyId: string,
  queue: { readonly current: Promise<unknown> },
  replaceData: (next: ApplicationQuestionnaire) => void,
): Pick<QuestionnaireState, 'takeAtsForm' | 'takeHhForm'> {
  return {
    takeAtsForm: async (atsForm, stale) => {
      try {
        await queue.current;
        const read = await saveAtsForm(vacancyId, atsForm);
        const answers = draftOf(read);
        const gone = Object.fromEntries(stale(answers).map((id) => [id, '']));
        const next =
          Object.keys(gone).length > 0
            ? await saveQuestionnaireAnswers(vacancyId, answersOf({ ...answers, ...gone }))
            : read;
        replaceData(next);
        return next.state === 'ready';
      } catch {
        return false;
      }
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

/** Анкета работодателя по вакансии: загрузка, черновик ответов и их сохранение. */
export function useQuestionnaire(vacancyId: string): QuestionnaireState {
  const load = useCallback(
    (signal: AbortSignal) => getQuestionnaire(vacancyId, signal),
    [vacancyId],
  );
  const { state, reload, replaceData } = useAsync(load, '');
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
    loading: state.status === 'loading' && !data,
    known: title ? { vacancyTitle: title, companyName: data?.vacancyCompany ?? '' } : null,
    draft,
    reload,
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
    ...formTakers(vacancyId, queue, replaceData),
  };
}

interface AnswerFieldProps {
  readonly fieldId: string;
  readonly question: QuestionnaireQuestion;
  readonly value: string;
  readonly state: QuestionnaireState;
  readonly invalid: boolean;
}

function isChoice(question: QuestionnaireQuestion): boolean {
  return question.kind === 'choice' && Boolean(question.options?.length);
}

/** Поле ответа: у вопроса с вариантами — выбор из них, иначе свободный текст. */
function AnswerField({ fieldId, question, value, state, invalid }: AnswerFieldProps) {
  if (isChoice(question)) {
    const pick = (next: string) => {
      state.setAnswer(question.id, next);
      state.save({ ...state.draft, [question.id]: next });
    };
    return <ChoiceField fieldId={fieldId} question={question} value={value} onPick={pick} />;
  }
  const shared = {
    id: fieldId,
    placeholder: 'Ваш ответ',
    maxLength: QUESTIONNAIRE_ANSWER_MAX_LENGTH,
    value,
    'aria-invalid': invalid || undefined,
    'aria-describedby': invalid ? `${fieldId}-err` : undefined,
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      state.setAnswer(question.id, event.currentTarget.value),
    onBlur: () => state.save(),
  };
  return question.singleLine ? (
    <input type="text" {...shared} />
  ) : (
    <textarea rows={2} {...shared} />
  );
}

interface QuestionProps {
  readonly question: QuestionnaireQuestion;
  readonly suggestion: QuestionnaireSuggestion | undefined;
  readonly state: QuestionnaireState;
  readonly rejected: FormStepProps['rejected'];
}

function Question({ question, suggestion, state, rejected }: QuestionProps) {
  const fieldId = `qa-${question.id}`;
  const value = answerOf(state.draft, question.id);
  const invalid = rejected?.answers.get(question.id) === value;
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
        <AnswerField
          fieldId={fieldId}
          question={question}
          value={value}
          state={state}
          invalid={invalid}
        />
        {invalid ? (
          <div id={`${fieldId}-err`}>
            <StatusLine state="err" text={`${rejected?.host ?? ''} не принял ответ`} />
          </div>
        ) : null}
      </div>
    </li>
  );
}

interface ActionsProps {
  readonly form: ApplicationQuestionnaire;
  readonly ready: FormReadiness;
  readonly state: QuestionnaireState;
  /** Анкета hh.ru в приложении: отклик с ответами уходит отсюда (o04). */
  readonly onSend: (() => void) | null;
  readonly declined: boolean;
}

/** B787: вопрос hh.ru о показе резюме — строкой анкеты; без «Да» отклик не уходит. */
function VisibilityRow({ visibility }: { readonly visibility: VisibilityState }) {
  return (
    <li className="qa">
      <div className="qa-q">
        <span>{VISIBILITY_QUESTION.text}</span>
      </div>
      <div className="field">
        <ChoiceField
          fieldId={`qa-${VISIBILITY_QUESTION.id}`}
          question={VISIBILITY_QUESTION}
          value={visibility.value ?? ''}
          onPick={visibility.set}
        />
      </div>
    </li>
  );
}

/** Переводит к полю вопроса: прокрутка и фокус, без смены адреса. */
function focusField(fieldId: string): void {
  const field = document.getElementById(fieldId);
  field?.scrollIntoView({ block: 'center' });
  field?.focus();
}

/** Главное действие: ответы для сайта копируются всегда (o04b), отправка ведёт к обязательным. */
function FormActions({ form, ready, state, onSend, declined }: ActionsProps) {
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
      {!onSend ? (
        <Button variant="primary" icon="copy" disabled={ready.answered === 0} onClick={copy}>
          Скопировать ответы
        </Button>
      ) : ready.nextRequired ? (
        <Button
          variant="primary"
          icon="edit"
          onClick={() => focusField(`qa-${ready.nextRequired?.id}`)}
        >
          <span>
            Ответьте<span className="qa-must"> на обязательные</span>
            {` · ${ready.missingRequired}`}
          </span>
        </Button>
      ) : null}
      {onSend ? (
        <Button
          variant={ready.nextRequired ? undefined : 'primary'}
          icon="send"
          disabled={Boolean(ready.nextRequired) || declined || state.submitted.kind === 'done'}
          onClick={onSend}
        >
          Отправить отклик с анкетой
        </Button>
      ) : null}
    </>
  );
}

function SiteLink({ form, onSend }: Pick<ActionsProps, 'form' | 'onSend'>) {
  if (!form.formUrl || onSend) return null;
  return (
    <a className="row-act" href={form.formUrl} target="_blank" rel="noopener noreferrer">
      Анкета на сайте ↗
    </a>
  );
}

function SubmittedBlock({
  state,
  onHh,
}: {
  readonly state: QuestionnaireState;
  readonly onHh: boolean;
}) {
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
          <Button
            variant="quiet"
            icon="check"
            busy={mark.kind === 'busy'}
            onClick={state.markSubmitted}
          >
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
  readonly visibility: VisibilityState;
  /** Форма сайта работодателя уходит из приложения (B787). */
  readonly viaApp?: 'open' | 'locked';
  /** Ответы, которые сайт работодателя не принял. */
  readonly rejected?: { readonly host: string; readonly answers: ReadonlyMap<string, string> };
  readonly onSend: () => void;
}

/** Действие анкеты на широком экране — в полосе внизу; на 390 оно закреплено под вопросами. */
function FormDock({ children }: { readonly children: ReactNode }) {
  return useIsMobile() ? null : <div className="act-dock is-auto qa-dock">{children}</div>;
}

/** Готовность анкеты вместе с вопросом о показе резюме, когда он задан. */
function readinessOf(
  form: ApplicationQuestionnaire,
  state: QuestionnaireState,
  visibility: VisibilityState | null,
) {
  if (!visibility) return readiness(form.questions, state.draft);
  return readiness([...form.questions, VISIBILITY_QUESTION], {
    ...state.draft,
    [VISIBILITY_QUESTION.id]: visibility.value ?? '',
  });
}

function FormSide(props: {
  readonly form: ApplicationQuestionnaire;
  readonly ready: ReturnType<typeof readiness>;
  readonly onSend: (() => void) | null;
}) {
  return (
    <aside className="qa-side" aria-label="Готовность анкеты">
      <p className="qa-count">
        <b className="num">{`${props.ready.answered} из ${props.ready.total}`}</b> готовы
      </p>
      <SiteLink form={props.form} onSend={props.onSend} />
    </aside>
  );
}

/** Шаг «Анкета» (O4b): вопросы работодателя, ответы кандидата и переход на страницу анкеты. */
export function FormStep({ state, form, visibility, viaApp, rejected, onSend }: FormStepProps) {
  const onHh = Boolean(form.formUrl && hhFormUrl(form.formUrl));
  const hhInApp = onHh && isTauriEnvironment();
  const inApp = hhInApp || viaApp !== undefined;
  const send = inApp ? onSend : null;
  const asked = hhInApp && visibility.value !== null;
  const ready = readinessOf(form, state, asked ? visibility : null);
  const suggestions = new Map(form.suggestions.map((item) => [item.questionId, item]));
  const declined = (asked && !visibility.agreed) || viaApp === 'locked';
  const actions = (
    <FormActions form={form} ready={ready} state={state} onSend={send} declined={declined} />
  );
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
                rejected={rejected}
              />
            ))}
            {asked ? <VisibilityRow visibility={visibility} /> : null}
          </ul>
          {state.saveError ? <StatusLine state="err" text={state.saveError} /> : null}
          <div className="actions m-commit qa-mob">
            {actions}
            <SiteLink form={form} onSend={send} />
          </div>
        </section>
      </div>
      <div className="col">
        <FormSide form={form} ready={ready} onSend={send} />
        {inApp ? null : <SubmittedBlock state={state} onHh={onHh} />}
      </div>
      <FormDock>{actions}</FormDock>
    </>
  );
}
