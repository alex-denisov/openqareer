import { useEffect, useRef, useState } from 'react';
import type { HhFormAnswer } from '../../../../../shared/hhCandidateSession';
import { pluralRu } from '../../../../../shared/pluralRu';
import { Button, Dialog, Icon, Link, ResultLine, StatusLine, useToast } from '../../kit';
import { buildNodePath } from '../../routes';
import { UNKNOWN_VACANCY_TITLE, type ApplyHead } from '../model/applyModel';
import { showHhCaptcha, showHhResponse } from './hhDesktop';
import { editsWord, HhResumeEdits } from './HhResumeEdits';
import { HhResumeSheet } from './HhResumeSheet';
import { useHhResumeEdits } from './useHhResumeEdits';
import { elapsedLabel, QUESTION_TEXT, uniqueResumeTitle, type HhSendQuestion } from './hhSendModel';
import { useHhApply, type HhApplyControls, type HhApplyInput } from './useHhApply';
import { useMarkSent, type MarkSentState } from './useMarkSent';
import { useHhResumes, type HhResumesState } from './useHhResumes';

export interface HhSendStepProps {
  /** Вакансия платформы: с ней сверяются резюме hh.ru (B678). */
  readonly vacancyId: string;
  /** Номер вакансии на hh.ru из её ссылки. */
  readonly hhVacancyId: string;
  readonly head: ApplyHead;
  readonly applicationId: string;
  readonly approvedLabel: string;
  readonly letterText: string;
  readonly onSent: () => Promise<void>;
  /** a01: название письма открывает шаг «Письмо». */
  readonly onLetter: () => void;
  /** B641: анкета вакансии, если её вопросы прочитаны. */
  readonly form: HhSendForm | null;
  readonly onForm: HhApplyInput['onForm'];
  /** o04: «Отправить отклик с анкетой» — сразу спросить подтверждение. */
  readonly askNow?: boolean;
  readonly onAsked?: () => void;
}

export interface HhSendForm {
  readonly answered: number;
  readonly complete: boolean;
  /** Ответы одним текстом для вставки. */
  readonly answersText: string;
  readonly answers: readonly HhFormAnswer[];
  readonly onSubmitted: () => void;
  readonly open: () => void;
}

interface PartsProps {
  readonly props: HhSendStepProps;
  readonly resumes: HhResumesState;
  readonly editCount: number;
  readonly onEdits: () => void;
}

function Parts({ props, resumes, editCount, onEdits }: PartsProps) {
  const selected = resumes.snapshot?.selected ?? null;
  return (
    <ul className="rows exp-rows ap-parts" aria-label="Что уйдёт в отклике">
      <li className="row">
        <div>
          <button className="row-title ap-pick" type="button" onClick={props.onLetter}>
            Письмо · {props.approvedLabel}
          </button>
          <p className="ap-lines">{props.letterText}</p>
        </div>
        <span className="tag ok">готово</span>
      </li>
      <li className="row">
        <div>
          <button className="row-title ap-pick" type="button" onClick={resumes.openPicker}>
            {selected ? `Резюме hh.ru «${selected.title}»` : 'Выбрать резюме hh.ru'}
          </button>
          {selected && editCount > 0 ? (
            <button className="res-act" type="button" onClick={onEdits}>
              {editsWord(editCount)}
            </button>
          ) : null}
        </div>
        {selected ? <span className="tag ok">готово</span> : null}
      </li>
      {props.form ? (
        <li className="row">
          <div>
            <button className="row-title ap-pick" type="button" onClick={props.form.open}>
              {`${props.form.answered} ${pluralRu(props.form.answered, ['ответ', 'ответа', 'ответов'])} анкеты`}
            </button>
          </div>
          {props.form.complete ? <span className="tag ok">готово</span> : null}
        </li>
      ) : null}
    </ul>
  );
}

/** B641: вопросы анкеты не прочитались — кандидат отвечает в окне hh.ru, отклик отметится сам. */
function FormNeeded({ answersText }: { readonly answersText: string }) {
  const toast = useToast();
  const copy = () => {
    void Promise.resolve()
      .then(() => navigator.clipboard.writeText(answersText))
      .then(() => toast.show({ text: 'Ответы скопированы' }))
      .catch(() => toast.show({ text: 'Не получилось скопировать' }));
  };
  return (
    <>
      <StatusLine state="err" text="Не отправлен · работодатель просит анкету" />
      <div className="actions">
        {answersText ? (
          <Button variant="primary" icon="copy" onClick={copy}>
            Скопировать ответы
          </Button>
        ) : null}
        <Button icon="out" onClick={() => void showHhResponse()}>
          Открыть окно hh.ru
        </Button>
      </div>
    </>
  );
}

/** Вопрос hh.ru до отклика: ответ кандидата на месте, отклик уходит снова с ним. */
function HhQuestion({ about, apply }: { readonly about: HhSendQuestion; readonly apply: HhApplyControls }) {
  const { text, yes } = QUESTION_TEXT[about];
  return (
    <>
      <StatusLine state="err" text={`Не отправлен · ${text}`} />
      <div className="actions">
        <Button variant="primary" icon="send" onClick={apply.agree}>
          {yes}
        </Button>
        <Button onClick={apply.cancel}>Отмена</Button>
      </div>
    </>
  );
}

interface OutcomeProps {
  readonly apply: HhApplyControls;
  readonly resumes: HhResumesState;
  readonly responsePath: string;
  readonly props: HhSendStepProps;
}

const SENT_TEXT = {
  sent: 'Отклик отправлен на hh.ru',
  questionnaire: 'Отклик отправлен · работодатель просит заполнить анкету на hh.ru',
  already: 'Вы уже откликнулись на hh.ru',
} as const;

function isSent(kind: string): kind is keyof typeof SENT_TEXT {
  return Object.hasOwn(SENT_TEXT, kind);
}

function Outcome({ apply, resumes, responsePath, props }: OutcomeProps) {
  const { state } = apply;
  if (state.kind === 'sending') {
    return <StatusLine state="wait" text={`Ждём ответа hh.ru · ${elapsedLabel(state.seconds)}`} />;
  }
  if (state.kind === 'signin') {
    const signIn = (
      <button className="res-act" type="button" onClick={resumes.signIn}>
        Войти в hh.ru
      </button>
    );
    return <StatusLine state="err" text="Не отправлен · нужен вход в hh.ru" action={signIn} />;
  }
  if (state.kind === 'form') {
    return <FormNeeded answersText={props.form?.answersText ?? ''} />;
  }
  if (state.kind === 'question') return <HhQuestion about={state.about} apply={apply} />;
  if (state.kind === 'error') {
    const open = (
      <button className="res-act" type="button" onClick={() => void (state.captcha ? showHhCaptcha() : showHhResponse())}>
        Открыть окно hh.ru
      </button>
    );
    return <StatusLine state="err" text={state.text} action={state.inWindow ? open : undefined} />;
  }
  if (!isSent(state.kind)) return null;
  return (
    <>
      <ResultLine
        text={SENT_TEXT[state.kind]}
      />
      <div className="actions">
        <Link className="btn is-primary" to={responsePath}>
          <Icon name="right" />К отклику
        </Link>
      </div>
    </>
  );
}

function MarkedOutcome({ marked, responsePath }: { readonly marked: MarkSentState; readonly responsePath: string }) {
  if (marked.kind === 'error') return <StatusLine state="err" text={marked.text} />;
  if (marked.kind !== 'done') return null;
  return (
    <>
      <ResultLine text="Отклик отмечен как отправленный" />
      <div className="actions">
        <Link className="btn is-primary" to={responsePath}>
          <Icon name="right" />К отклику
        </Link>
      </div>
    </>
  );
}

function ConfirmDialog({ apply, title }: { apply: HhApplyControls; title: string }) {
  const footer = (
    <>
      <Button onClick={apply.cancel}>Отмена</Button>
      <Button variant="primary" icon="send" onClick={apply.confirm}>
        Отправить
      </Button>
    </>
  );
  return (
    <Dialog className="hh-ask" open={apply.state.kind === 'confirm'} onClose={apply.cancel} title="Отправить отклик на hh.ru?" footer={footer}>
      <p>Отклик на «{title}» уйдёт от вашего имени из вашего входа в hh.ru.</p>
    </Dialog>
  );
}

function useStepApply(props: HhSendStepProps, { snapshot }: HhResumesState): HhApplyControls {
  const apply = useHhApply({
    vacancyId: props.hhVacancyId,
    resumeId: snapshot?.selected?.id ?? null,
    vacancyTitle: props.head.title === UNKNOWN_VACANCY_TITLE ? undefined : props.head.title,
    letter: props.letterText,
    uniqueResumeTitle: uniqueResumeTitle(snapshot),
    onSent: props.onSent,
    onForm: props.onForm,
    ...(props.form ? { answers: props.form.answers, onFormSent: props.form.onSubmitted } : {}),
  });
  useAskNow(props, Boolean(snapshot?.selected), apply);
  return apply;
}

/** Окно подтверждения открывается один раз, когда резюме известно. */
function useAskNow({ askNow, onAsked }: HhSendStepProps, ready: boolean, apply: HhApplyControls): void {
  const ask = useRef(apply.ask);
  ask.current = apply.ask;
  useEffect(() => {
    if (!askNow || !ready) return;
    ask.current();
    onAsked?.();
  }, [askNow, ready, onAsked]);
}

/** Шаг «Отправка» в приложении (a01): отклик через hh.ru от имени кандидата после подтверждения. */
export function HhSendStep(props: HhSendStepProps) {
  const resumes = useHhResumes(props.vacancyId);
  const { edits, loading: editsLoading } = useHhResumeEdits(props.vacancyId, resumes.snapshot);
  const [reviewing, setReviewing] = useState(false);
  const selected = resumes.snapshot?.selected;
  const resumeId = selected?.id ?? null;
  const apply = useStepApply(props, resumes);
  const marked = useMarkSent(props.onSent);
  const sent = isSent(apply.state.kind);
  const done = sent || marked.state.kind === 'done';
  const responsePath = buildNodePath('o01c', { responseId: props.applicationId });
  if (reviewing && editsLoading) return <StatusLine state="wait" text="Готовим правки" />;
  if (reviewing && selected && edits.length > 0) {
    return <HhResumeEdits resumeId={selected.id} resumeTitle={selected.title} edits={edits} onBack={() => setReviewing(false)} />;
  }
  return (
    <section className="lead" aria-labelledby="w-title">
      <h2 className="lead-title is-long" id="w-title">
        Всё одобрено — можно отправлять
      </h2>
      <Parts props={props} resumes={resumes} editCount={edits.length} onEdits={() => setReviewing(true)} />
      {done ? null : (
        <div className="actions">
          <Button variant="primary" icon="send" busy={apply.state.kind === 'sending'} disabled={!resumeId || resumes.loading} onClick={apply.ask}>
            Отправить отклик
          </Button>
          <a className="btn m-ico" href={props.head.url ?? undefined} target="_blank" rel="noopener noreferrer">
            <Icon name="out" />
            Вакансия на hh.ru
          </a>
          <Button variant="quiet" icon="checkc" busy={marked.state.kind === 'busy'} disabled={apply.state.kind === 'sending'} onClick={marked.mark}>
            Я уже откликнулся
          </Button>
        </div>
      )}
      <Outcome apply={apply} resumes={resumes} responsePath={responsePath} props={props} />
      {sent ? null : <MarkedOutcome marked={marked.state} responsePath={responsePath} />}
      <ConfirmDialog apply={apply} title={props.head.title} />
      <HhResumeSheet
        picker={resumes.picker}
        currentId={resumeId}
        saving={resumes.saving}
        onClose={resumes.closePicker}
        onSignIn={resumes.signIn}
        onRetry={resumes.openPicker}
        onChoose={(item, optimize) => resumes.choose(item, () => setReviewing(optimize))}
      />
    </section>
  );
}
