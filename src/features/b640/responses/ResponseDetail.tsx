import { useEffect, useRef, useState } from 'react';
import type { ApplicationStage } from '../../../../shared/applicationStage';
import { vacancySourceLabel } from '../../../../shared/vacancySourceLabel';
import {
  patchApplication,
  recordFollowUpSent,
  restoreApplicationFromArchive,
  type ApplicationView,
} from '../../applications/applicationsApi';
import { generateCompanyReminderDraft } from '../../applications/companyReminderDraft';
import { apiErrorMessage } from '../../coach/apiClient';
import { Button, Icon, Link, ResultLine, StatusLine, useToast } from '../kit';
import { buildNodePath } from '../routes';
import { timeline, type ListedResponse, type TimelineEvent } from './model/responseList';
import { actionPath } from './ResponsesTable';

type Outcome =
  | { readonly kind: 'idle' }
  | { readonly kind: 'busy' }
  | { readonly kind: 'done'; readonly text: string }
  | { readonly kind: 'error'; readonly text: string; readonly retry: () => void };

interface Mark {
  readonly stage: ApplicationStage;
  readonly label: string;
  readonly done: string;
}

const MARKS: readonly Mark[] = [
  { stage: 'responded', label: 'Ответили', done: 'Отмечено: ответили' },
  { stage: 'interview', label: 'Пригласили на интервью', done: 'Отмечено: интервью' },
  { stage: 'offer', label: 'Прислали оффер', done: 'Отмечено: оффер' },
  { stage: 'rejected', label: 'Отказали', done: 'Отмечено: отказ' },
  { stage: 'archived', label: 'В архив', done: 'Отклик в архиве' },
];

const STAGE_ORDER: readonly ApplicationStage[] = [
  'saved', 'applied', 'responded', 'interview', 'offer', 'rejected', 'archived',
];

/** Что можно отметить дальше: только стадии после текущей. */
export function marksFor(stage: ApplicationStage): readonly Mark[] {
  if (stage === 'rejected' || stage === 'archived') return [];
  if (stage === 'saved') return MARKS.filter((mark) => mark.stage === 'archived');
  const at = STAGE_ORDER.indexOf(stage);
  return MARKS.filter((mark) => STAGE_ORDER.indexOf(mark.stage) > at);
}

function Events({ events }: { readonly events: readonly TimelineEvent[] }) {
  return (
    <ul className="tl">
      {events.map((item) => (
        <li className="on" key={`${item.title}-${item.at}`}>
          <Icon name={item.icon} />
          <span className="od-ev">
            <b>{item.title}</b>
            {item.note ? <small>{item.note}</small> : null}
          </span>
          <span className="when num">{item.when}</span>
        </li>
      ))}
    </ul>
  );
}

function History({ application }: { readonly application: ApplicationView }) {
  const events = timeline(application);
  if (events.length === 0) return null;
  const rest = events.slice(1);
  return (
    <div className="od-was">
      <h4>Что было</h4>
      <Events events={events.slice(0, 1)} />
      {rest.length > 0 ? (
        <details className="more-n">
          <summary>
            <Icon name="down" />
            {`Ещё ${rest.length}`}
          </summary>
          <Events events={rest} />
        </details>
      ) : null}
    </div>
  );
}

export interface ResponseDetailProps {
  readonly item: ListedResponse;
  readonly titleId: string;
  /** Отклик изменился на сервере: обновить строку списка. */
  readonly onChanged: (next: ApplicationView) => void;
}

/** Раскрытый отклик (O1c): что дальше, что было, заметка и ссылка на вакансию. */
export function ResponseDetail({ item, titleId, onChanged }: ResponseDetailProps) {
  const { application, row } = item;
  const toast = useToast();
  const [outcome, setOutcome] = useState<Outcome>({ kind: 'idle' });
  const [note, setNote] = useState(application.notes ?? '');
  const [noteState, setNoteState] = useState<Outcome>({ kind: 'idle' });
  const [draft, setDraft] = useState(() =>
    generateCompanyReminderDraft({
      company: application.vacancy?.company,
      positionTitle: application.vacancy?.title ?? '',
    }),
  );
  const marksRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    setNote(application.notes ?? '');
  }, [application.id, application.notes]);

  async function run(action: () => Promise<ApplicationView>, done: string, undo?: () => void) {
    setOutcome({ kind: 'busy' });
    try {
      const next = await action();
      onChanged(next);
      setOutcome({ kind: 'done', text: done });
      if (undo) toast.show({ text: done, undo: { label: 'Отменить', onUndo: undo } });
    } catch (reason: unknown) {
      setOutcome({
        kind: 'error',
        text: apiErrorMessage(reason, 'Не получилось сохранить. Повторите.'),
        retry: () => void run(action, done, undo),
      });
    }
  }

  function mark(target: Mark) {
    if (marksRef.current) marksRef.current.open = false;
    const previous = application.stage;
    void run(
      () => patchApplication(application.id, { expectedVersion: application.version, stage: target.stage }),
      target.done,
      () => {
        void patchApplication(application.id, {
          expectedVersion: application.version + 1,
          stage: previous,
        })
          .then((restored) => {
            onChanged(restored);
            setOutcome({ kind: 'idle' });
          })
          .catch((reason: unknown) =>
            setOutcome({
              kind: 'error',
              text: apiErrorMessage(reason, 'Не получилось отменить.'),
              retry: () => setOutcome({ kind: 'idle' }),
            }),
          );
      },
    );
  }

  async function saveNote() {
    const value = note.trim();
    if (value === (application.notes ?? '').trim()) return;
    setNoteState({ kind: 'busy' });
    try {
      onChanged(
        await patchApplication(application.id, {
          expectedVersion: application.version,
          notes: value || null,
        }),
      );
      setNoteState({ kind: 'done', text: 'Заметка сохранена' });
    } catch (reason: unknown) {
      setNoteState({
        kind: 'error',
        text: apiErrorMessage(reason, 'Заметка не сохранилась.'),
        retry: () => void saveNote(),
      });
    }
  }

  const marks = marksFor(application.stage);
  const interviewAhead = application.stage === 'interview' && row.tag.tone !== 'ok';
  const source = application.vacancy?.source
    ? vacancySourceLabel({ sourceType: application.vacancy.source })
    : null;
  const url = application.vacancy?.url;

  return (
    <>
      <h3 className="od-head" id={titleId}>
        Что дальше
      </h3>
      {row.failure ? <StatusLine state="err" text={`Не доставлен · ${row.failure}`} /> : null}
      <p>
        <b>{row.next}</b>
      </p>
      {row.remind ? (
        <div className="lk-inline" role="group" aria-labelledby={`${titleId}-dr`}>
          <div className="lk-dr-top">
            <label className="lk-lbl" id={`${titleId}-dr`} htmlFor={`${titleId}-drt`}>
              Напоминание
            </label>
          </div>
          <textarea
            className="lk-draft lk-edit"
            id={`${titleId}-drt`}
            rows={5}
            value={draft}
            onChange={(event) => setDraft(event.currentTarget.value)}
          />
        </div>
      ) : null}
      <div className="actions">
        {row.action ? (
          <Link className="btn is-primary" to={actionPath(row)}>
            <Icon name={row.action.icon} />
            {row.action.label}
          </Link>
        ) : null}
        {row.remind ? (
          <>
            <Button
              variant="primary"
              icon="check"
              busy={outcome.kind === 'busy'}
              onClick={() => void run(() => recordFollowUpSent(application.id), 'Отмечено: вы напомнили о себе')}
            >
              Я напомнил
            </Button>
            <Button
              icon="copy"
              onClick={() => {
                void navigator.clipboard
                  .writeText(draft)
                  .then(() => toast.show({ text: 'Текст скопирован' }))
                  .catch(() => toast.show({ text: 'Не получилось скопировать' }));
              }}
            >
              Скопировать
            </Button>
          </>
        ) : null}
        {application.stage === 'interview' ? (
          <Link
            className="btn is-primary"
            to={buildNodePath(interviewAhead ? 'i01' : 'i04', { responseId: application.id })}
          >
            <Icon name={interviewAhead ? 'checkc' : 'mic'} />
            {interviewAhead ? 'Подготовиться к интервью' : 'Рассказать, как прошло'}
          </Link>
        ) : null}
        {application.stage === 'archived' ? (
          <Button
            icon="undo"
            busy={outcome.kind === 'busy'}
            onClick={() =>
              void run(
                () => restoreApplicationFromArchive(application.id, application.version),
                'Отклик возвращён из архива',
              )
            }
          >
            Вернуть из архива
          </Button>
        ) : null}
        {marks.length > 0 ? (
          <details className="ways" ref={marksRef}>
            <summary className="btn">
              <Icon name="more" />
              Отметить ответ
            </summary>
            <ul className="ways-list">
              {marks.map((target) => (
                <li key={target.stage}>
                  <button className="row-act" type="button" onClick={() => mark(target)}>
                    {target.label}
                  </button>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>
      {outcome.kind === 'done' ? <ResultLine text={outcome.text} /> : null}
      {outcome.kind === 'error' ? (
        <StatusLine
          state="err"
          text={outcome.text}
          action={
            <Button size="sm" onClick={outcome.retry}>
              Повторить
            </Button>
          }
        />
      ) : null}
      <History application={application} />
      <div className="field">
        <label htmlFor={`${titleId}-note`}>Ваша заметка</label>
        <textarea
          id={`${titleId}-note`}
          value={note}
          maxLength={20000}
          onChange={(event) => setNote(event.currentTarget.value)}
          onBlur={() => void saveNote()}
        />
        {noteState.kind === 'error' ? (
          <StatusLine
            state="err"
            text={noteState.text}
            action={
              <Button size="sm" onClick={noteState.retry}>
                Повторить
              </Button>
            }
          />
        ) : null}
        {noteState.kind === 'done' ? <ResultLine text={noteState.text} /> : null}
      </div>
      {url && /^https?:\/\//u.test(url) ? (
        <a className="row-act" href={url} target="_blank" rel="noopener noreferrer">
          <Icon name="out" /> {source ? `Вакансия на ${source}` : 'Вакансия'}
        </a>
      ) : null}
      <p className="vd-kbd od-kbd">
        <kbd>Esc</kbd> — свернуть
      </p>
    </>
  );
}
