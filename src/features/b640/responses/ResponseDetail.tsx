import { pressSend } from '../apply/applyIntent';
import { useRef, useState } from 'react';
import type { ApplicationView } from '../../applications/applicationsApi';
import type { ApplyConsentEntry } from '../../../../shared/applyConsent';
import { ConsentItems, ConsentTextLink } from '../account/consentParts';
import { Button, Icon, Link, ResultLine, StatusLine, useToast } from '../kit';
import { timeline, type ListedResponse, type TimelineEvent } from './model/responseList';
import { onPlatform, responsePlatform } from './model/platform';
import { reminderDraft } from './model/reminderDraft';
import { pluralRu } from './model/responseRow';
import { RejectionReasonForm } from './RejectionReasonForm';
import { useApplyConsents } from './useApplyConsents';
import { useSentMessages } from './useSentMessages';
import { actionPath } from './ResponsesTable';
import { InterviewActions } from './InterviewActions';
import { useRecordingLine } from './useRecordingLine';
import {
  marksFor,
  useResponseActions,
  useResponseNote,
  useResponseWriter,
  type Mark,
  type Outcome,
  type ResponseActions,
  type ResponseWriter,
} from './useResponseActions';

/** B787: сохранённый текст согласия, поручение, по которому оно дано, и данные записи. */
function ConsentRecord({ entry }: { readonly entry: ApplyConsentEntry }) {
  const facts = [
    entry.employer,
    entry.host,
    `${entry.occurredAt.slice(0, 19).replace('T', ' ')} UTC`,
    `Команда: ${entry.command}`,
    ...(entry.checkboxLabel ? [`Подпись у галочки: ${entry.checkboxLabel}`] : []),
    ...(entry.policySha256 ? [`SHA-256 политики: ${entry.policySha256}`] : []),
    `Поручение: ${entry.mandateVersion}`,
  ];
  return (
    <ConsentTextLink title="Согласие на обработку данных">
      <p className="c5-lead">{entry.checkboxText}</p>
      <ul className="c5-list">
        {facts.map((fact) => (
          <li key={fact}>{fact}</li>
        ))}
        {entry.policyUrl ? (
          <li>
            <a href={entry.policyUrl} target="_blank" rel="noopener noreferrer">
              Политика работодателя
            </a>
          </li>
        ) : null}
      </ul>
      <ConsentItems capability="actions_on_behalf" versionId={entry.mandateVersion} />
    </ConsentTextLink>
  );
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
            {item.consent ? <ConsentRecord entry={item.consent} /> : null}
          </span>
          <span className="when num">{item.when}</span>
        </li>
      ))}
    </ul>
  );
}

function History({ application }: { readonly application: ApplicationView }) {
  const messages = useSentMessages(application.clusterId);
  const consents = useApplyConsents(application.id);
  const events = timeline(application, new Date(), messages, consents);
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
            {`Ещё ${rest.length} ${pluralRu(rest.length, ['событие', 'события', 'событий'])}`}
          </summary>
          <Events events={rest} />
        </details>
      ) : null}
    </div>
  );
}

/** Результат или ошибка действия на его месте. */
function OutcomeLine({ outcome }: { readonly outcome: Outcome }) {
  if (outcome.kind === 'done') return <ResultLine text={outcome.text} />;
  if (outcome.kind !== 'error') return null;
  return (
    <StatusLine
      state="err"
      text={outcome.text}
      action={
        <Button size="sm" onClick={outcome.retry}>
          Повторить
        </Button>
      }
    />
  );
}

interface MarksProps {
  readonly marks: readonly Mark[];
  readonly disabled: boolean;
  readonly onMark: (target: Mark) => void;
}

function MarkMenu({ marks, disabled, onMark }: MarksProps) {
  const ref = useRef<HTMLDetailsElement>(null);
  if (marks.length === 0) return null;
  return (
    <details className="ways" ref={ref}>
      <summary className="btn">
        <Icon name="more" />
        Отметить ответ
      </summary>
      <ul className="ways-list">
        {marks.map((target) => (
          <li key={target.stage}>
            <button
              className="row-act"
              type="button"
              disabled={disabled}
              onClick={() => {
                if (ref.current) ref.current.open = false;
                onMark(target);
              }}
            >
              {target.label}
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}

interface ReminderProps {
  readonly fieldId: string;
  readonly draft: string;
  readonly onChange: (value: string) => void;
}

function ReminderDraft({ fieldId, draft, onChange }: ReminderProps) {
  return (
    <div className="lk-inline">
      <div className="lk-dr-top">
        <label className="lk-lbl" htmlFor={fieldId}>
          Напоминание
        </label>
      </div>
      <textarea
        className="lk-draft lk-edit"
        id={fieldId}
        rows={5}
        value={draft}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    </div>
  );
}

/** Копирует текст и говорит о результате тостом. */
function useCopy(text: string): () => void {
  const toast = useToast();
  return () => {
    const failed = () => toast.show({ text: 'Не получилось скопировать' });
    try {
      void navigator.clipboard
        .writeText(text)
        .then(() => toast.show({ text: 'Текст скопирован' }))
        .catch(failed);
    } catch {
      failed();
    }
  };
}

interface ActionsProps {
  readonly item: ListedResponse;
  readonly actions: ResponseActions;
  readonly draft: string;
}

function NextActions({ item, actions, draft }: ActionsProps) {
  const { application, row } = item;
  const copy = useCopy(draft);
  const busy = actions.outcome.kind === 'busy';
  const interview = application.stage === 'interview';
  const interviewAhead = interview && row.tag.tone !== 'ok';
  const past = interview && !interviewAhead;
  const marks = marksFor(application.stage);
  // Макет o01c: после интервью «В архив» — в «Другом способе», остальные отметки — в меню.
  const archive = past ? marks.find((mark) => mark.stage === 'archived') : undefined;
  const menuMarks = archive ? marks.filter((mark) => mark !== archive) : marks;
  return (
    <div className="actions">
      {row.action && row.action.kind !== 'debrief' ? (
        <Link
          className="btn is-primary"
          to={actionPath(row)}
          onClick={() => row.action && pressSend(row.action, actionPath(row))}
        >
          <Icon name={row.action.icon} />
          {row.action.label}
        </Link>
      ) : null}
      {row.remind ? (
        <>
          <Button variant="primary" icon="check" busy={busy} onClick={actions.remindSent}>
            Я напомнил
          </Button>
          <Button icon="copy" onClick={copy}>
            Скопировать
          </Button>
        </>
      ) : null}
      {interview ? (
        <InterviewActions
          responseId={application.id}
          ahead={interviewAhead}
          archive={archive}
          disabled={busy}
          onArchive={actions.mark}
        />
      ) : null}
      {application.stage === 'archived' ? (
        <Button icon="undo" busy={busy} onClick={actions.restore}>
          Вернуть из архива
        </Button>
      ) : null}
      <MarkMenu marks={menuMarks} disabled={busy} onMark={actions.mark} />
    </div>
  );
}

function pastInterview(item: ListedResponse): boolean {
  return item.application.stage === 'interview' && item.row.tag.tone === 'ok';
}

/** Что дальше: после интервью — вопрос, как оно прошло, и есть ли запись (макет o01c). */
function NextLine({ item }: { readonly item: ListedResponse }) {
  const past = pastInterview(item);
  const recording = useRecordingLine(item.application.id, past);
  if (!past) {
    return (
      <p>
        <b>{item.row.next}</b>
      </p>
    );
  }
  return (
    <p>
      <b>{`Как прошло интервью с ${item.row.company}?`}</b>
      {recording ? ` ${recording}` : null}
    </p>
  );
}

interface NoteProps {
  readonly fieldId: string;
  readonly application: ApplicationView;
  readonly writer: ResponseWriter;
}

function NoteField({ fieldId, application, writer }: NoteProps) {
  const state = useResponseNote(application, writer);
  return (
    <div className="field">
      <label htmlFor={fieldId}>Ваша заметка</label>
      <textarea
        id={fieldId}
        value={state.note}
        maxLength={20000}
        onChange={(event) => state.setNote(event.currentTarget.value)}
        onBlur={state.save}
      />
      <OutcomeLine outcome={state.outcome} />
    </div>
  );
}

function VacancyLink({ application }: { readonly application: ApplicationView }) {
  const url = application.vacancy?.url;
  if (!url || !/^https?:\/\//u.test(url)) return null;
  const place = onPlatform(responsePlatform(application));
  return (
    <a className="row-act" href={url} target="_blank" rel="noopener noreferrer">
      <Icon name="out" /> {`Вакансия ${place}`}
    </a>
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
  const writer = useResponseWriter(application, onChanged);
  const actions = useResponseActions(application, writer);
  const [draft, setDraft] = useState(() => reminderDraft(application));
  return (
    <>
      <h3 className="od-head" id={titleId}>
        Что дальше
      </h3>
      {row.failure ? <StatusLine state="err" text={`Не доставлен · ${row.failure}`} /> : null}
      <NextLine item={item} />
      {row.remind ? (
        <ReminderDraft fieldId={`${titleId}-drt`} draft={draft} onChange={setDraft} />
      ) : null}
      <NextActions item={item} actions={actions} draft={draft} />
      <OutcomeLine outcome={actions.outcome} />
      {application.stage === 'rejected' ? (
        <RejectionReasonForm key={application.id} applicationId={application.id} />
      ) : null}
      <History application={application} />
      <NoteField fieldId={`${titleId}-note`} application={application} writer={writer} />
      <VacancyLink application={application} />
    </>
  );
}
