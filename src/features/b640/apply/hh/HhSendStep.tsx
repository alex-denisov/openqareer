import { useState } from 'react';
import { Button, Dialog, Icon, Link, ResultLine, StatusLine } from '../../kit';
import { buildNodePath } from '../../routes';
import type { ApplyHead } from '../model/applyModel';
import { editsWord, HhResumeEdits } from './HhResumeEdits';
import { HhResumeSheet } from './HhResumeSheet';
import { useHhResumeEdits } from './useHhResumeEdits';
import { elapsedLabel } from './hhSendModel';
import { useHhApply, type HhApplyControls } from './useHhApply';
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
      <li>
        <p>
          <b>Письмо</b> · {props.approvedLabel}
        </p>
        <p className="ap-lines">{props.letterText}</p>
        <span className="tag ok">готово</span>
      </li>
      <li>
        <p>
          <b>Резюме hh.ru</b> {selected ? `«${selected.title}»` : null}
        </p>
        <button className="res-act" type="button" onClick={resumes.openPicker}>
          {selected ? 'Другое резюме' : 'Выбрать резюме'}
        </button>
        {selected && editCount > 0 ? (
          <button className="res-act" type="button" onClick={onEdits}>
            {editsWord(editCount)}
          </button>
        ) : null}
        {selected ? <span className="tag ok">готово</span> : null}
      </li>
    </ul>
  );
}

function Outcome({ apply, resumes, responsePath }: { apply: HhApplyControls; resumes: HhResumesState; responsePath: string }) {
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
  if (state.kind === 'error') return <StatusLine state="err" text={state.text} />;
  if (state.kind !== 'sent' && state.kind !== 'questionnaire') return null;
  return (
    <>
      <ResultLine
        text={state.kind === 'sent' ? 'Отклик отправлен на hh.ru' : 'Отклик отправлен · работодатель просит заполнить анкету на hh.ru'}
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
    <Dialog open={apply.state.kind === 'confirm'} onClose={apply.cancel} title="Отправить отклик на hh.ru?" footer={footer}>
      <p>Отклик на «{title}» уйдёт от вашего имени из вашего входа в hh.ru.</p>
    </Dialog>
  );
}

/** Шаг «Отправка» в приложении (a01): отклик через hh.ru от имени кандидата после подтверждения. */
export function HhSendStep(props: HhSendStepProps) {
  const resumes = useHhResumes(props.vacancyId);
  const edits = useHhResumeEdits(props.vacancyId, resumes.snapshot);
  const [reviewing, setReviewing] = useState(false);
  const resumeId = resumes.snapshot?.selected?.id ?? null;
  const apply = useHhApply({ vacancyId: props.hhVacancyId, resumeId, letter: props.letterText, onSent: props.onSent });
  const marked = useMarkSent(props.onSent);
  const sentHere = apply.state.kind === 'sent' || apply.state.kind === 'questionnaire';
  const done = sentHere || marked.state.kind === 'done';
  const busy = apply.state.kind === 'sending';
  const responsePath = buildNodePath('o01c', { responseId: props.applicationId });
  if (reviewing && resumes.snapshot?.selected && edits.length > 0) {
    const { selected } = resumes.snapshot;
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
          <Button variant="primary" icon="send" busy={busy} disabled={!resumeId || resumes.loading} onClick={apply.ask}>
            Отправить отклик
          </Button>
          <a className="btn m-ico" href={props.head.url ?? undefined} target="_blank" rel="noopener noreferrer">
            <Icon name="out" />
            Вакансия на hh.ru
          </a>
          <Button variant="quiet" icon="checkc" busy={marked.state.kind === 'busy'} disabled={busy} onClick={marked.mark}>
            Я уже откликнулся
          </Button>
        </div>
      )}
      <Outcome apply={apply} resumes={resumes} responsePath={responsePath} />
      <MarkedOutcome marked={marked.state} responsePath={responsePath} />
      <ConfirmDialog apply={apply} title={props.head.title} />
      <HhResumeSheet
        picker={resumes.picker}
        currentId={resumeId}
        saving={resumes.saving}
        onClose={resumes.closePicker}
        onSignIn={resumes.signIn}
        onRetry={resumes.openPicker}
        onChoose={resumes.choose}
      />
    </section>
  );
}
