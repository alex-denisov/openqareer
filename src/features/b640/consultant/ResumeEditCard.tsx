import { useCallback, useEffect, useRef, useState } from 'react';
import { CoachApiError } from '../../coach/apiClient';
import type { CandidateMemory } from '../../coach/coachApi';
import { applyFactRewrite, revertFactRewrite } from '../../resume/experienceFactRewriteApi';
import { forgetSharedRead } from '../../resume/sharedRead';
import { Icon } from '../kit/Icon';
import { InfoTip } from '../kit/InfoTip';
import { ResultLine } from '../kit/ResultLine';
import { buildNodePath } from '../routes';
import { Link } from '../shell/Link';
import { useScreenChrome } from '../shell/ShellContext';
import type { ChatMessage } from './model';
import { ErrorRow, Message, Reply } from './parts';
import { declineResumeEdit, loadResumeEdit, type ResumeEdit } from './resumeEdit';

type Loaded =
  | { readonly kind: 'loading' }
  | { readonly kind: 'failed' }
  | { readonly kind: 'declined' }
  | { readonly kind: 'ready'; readonly edit: ResumeEdit | null }
  | { readonly kind: 'applied'; readonly rewriteId: string };

type Failure = { readonly text: string; readonly retry: () => void } | null;

function isStale(reason: unknown): boolean {
  return reason instanceof CoachApiError && reason.code === 'rewrite_stale';
}

/** Чтение правки; ответ, пришедший после ухода или смены факта, отбрасывается. */
function useEdit(factId: string) {
  const [state, setState] = useState<Loaded>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setState({ kind: 'loading' });
    loadResumeEdit(factId)
      .then((edit) => live && setState({ kind: 'ready', edit }))
      .catch(() => live && setState({ kind: 'failed' }));
    return () => {
      live = false;
    };
  }, [factId, attempt]);
  const reload = useCallback(() => setAttempt((value) => value + 1), []);
  return { state, setState, reload };
}

/** Одно действие с правкой: занято, сбой с повтором. */
function useRun() {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure>(null);

  async function run(work: () => Promise<void>, onFail: (reason: unknown) => Failure) {
    setBusy(true);
    setFailure(null);
    try {
      await work();
      forgetSharedRead('resume');
    } catch (reason) {
      setFailure(onFail(reason));
    } finally {
      setBusy(false);
    }
  }
  return { busy, failure, setFailure, run };
}

/** Решения кандидата: применить, отклонить, отменить применённое. */
function useResumeEdit(factId: string) {
  const { state, setState, reload } = useEdit(factId);
  const { busy, failure, setFailure, run } = useRun();

  function reread() {
    setFailure(null);
    reload();
  }
  function apply(edit: ResumeEdit) {
    void run(
      async () => {
        const record = await applyFactRewrite(edit.proposalId, {}, [edit.key]);
        setState({ kind: 'applied', rewriteId: record.id });
      },
      (reason) => ({
        text: 'Правка не применилась',
        retry: isStale(reason) ? reread : () => apply(edit),
      }),
    );
  }
  function decline(edit: ResumeEdit) {
    void run(
      async () => {
        await declineResumeEdit(edit);
        setState({ kind: 'declined' });
      },
      () => ({ text: 'Не сохранилось', retry: () => decline(edit) }),
    );
  }
  function revert(rewriteId: string) {
    void run(
      async () => {
        await revertFactRewrite(rewriteId);
        reload();
      },
      () => ({ text: 'Не сохранилось', retry: () => revert(rewriteId) }),
    );
  }
  return { state, busy, failure, reload, apply, decline, revert };
}

/** Реплика K6: куда встанет строка и на какой записи кандидата она стоит. */
export function editReply(
  edit: ResumeEdit,
  memory: readonly CandidateMemory[],
  messages: readonly ChatMessage[],
): string {
  const facts = edit.sourceFactIds.flatMap((id) => {
    const fact = memory.find((item) => item.id === id && !item.sensitive);
    if (!fact) return [];
    const said = messages.find((item) => fact.sourceMessageIds.includes(item.id));
    const day = said?.at ? ` ${said.at.slice(8, 10)}.${said.at.slice(5, 7)}` : '';
    const from = said ? ` — из беседы${day}` : '';
    const confirmed = said && fact.status === 'confirmed' ? ', запись вы подтвердили: «Верно»' : '';
    return [`«${fact.statement}»${from}${confirmed}.`];
  });
  return [edit.place ? `Новая строка: «${edit.place}».` : 'Новая строка.', ...facts].join(' ');
}

const HALF_SHEET = { rootData: { half: '1' } } as const;

/** K6: ширина панели 400, на 390 — половина экрана без поля ввода; карточка в видимой части. */
function HalfSheet() {
  useScreenChrome(HALF_SHEET);
  const end = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const chat = end.current?.closest('.chat');
    if (chat) chat.scrollTop = chat.scrollHeight;
  }, []);
  return <span ref={end} hidden />;
}

interface EditBodyProps {
  readonly edit: ResumeEdit;
  readonly reason?: string;
  readonly busy: boolean;
  readonly onApply: () => void;
  readonly onDecline: () => void;
}

function EditBody({ edit, reason, busy, onApply, onDecline }: EditBodyProps) {
  return (
    <>
      <p className="ec-title">
        {edit.place}
        {reason ? <InfoTip label="Причина правки" text={reason} /> : null}
      </p>
      <dl className="ec-diff">
        <div className="now">
          <dt>Станет</dt>
          <dd>{edit.text}</dd>
        </div>
      </dl>
      <div className="msg-acts act-row ec-acts">
        <button className="btn is-sm is-primary" type="button" disabled={busy} onClick={onApply}>
          Применить
        </button>
        <button
          className="btn is-sm is-line ec-ib"
          type="button"
          aria-label="Отклонить"
          disabled={busy}
          onClick={onDecline}
        >
          <Icon name="close" />
          <span className="ec-ib-l">Отклонить</span>
          <span className="ec-tip" role="tooltip" aria-hidden="true">
            Отклонить
          </span>
        </button>
      </div>
    </>
  );
}

export interface ResumeEditCardProps {
  /** Факт из беседы, который надо показать в резюме. */
  readonly factId: string;
  readonly reason?: string;
  readonly memory: readonly CandidateMemory[];
  readonly messages: readonly ChatMessage[];
}

/** K6: готовая правка резюме; в резюме она попадает только после «Применить». */
export function ResumeEditCard({ factId, reason, memory, messages }: ResumeEditCardProps) {
  const { state, busy, failure, reload, apply, decline, revert } = useResumeEdit(factId);
  const error = failure ? <ErrorRow text={failure.text} onRetry={failure.retry} /> : null;
  if (state.kind === 'loading') return <Reply text="" />;
  if (state.kind === 'failed') return <ErrorRow text="Ответ не пришёл" onRetry={reload} />;
  if (state.kind === 'declined') return null;
  if (state.kind === 'applied') {
    return (
      <>
        <ResultLine text="Применено" onUndo={busy ? undefined : () => revert(state.rewriteId)} />
        {error}
      </>
    );
  }
  const { edit } = state;
  if (!edit) {
    return (
      <div className="msg-acts">
        <Link className="btn is-sm" to={buildNodePath('s01')}>
          <Icon name="profile" />
          Открыть профиль
        </Link>
      </div>
    );
  }
  return (
    <>
      <Message
        message={{ id: edit.key, role: 'assistant', content: editReply(edit, memory, messages) }}
      />
      <section className="ec" aria-label={`Правка резюме: ${edit.place}`} aria-busy={busy}>
        <EditBody
          edit={edit}
          reason={reason}
          busy={busy}
          onApply={() => apply(edit)}
          onDecline={() => decline(edit)}
        />
        {error}
      </section>
      <HalfSheet />
    </>
  );
}
