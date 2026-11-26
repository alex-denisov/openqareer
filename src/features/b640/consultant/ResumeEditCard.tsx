import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import type { VariantWish } from '../../../../shared/textVariants';
import { CoachApiError } from '../../coach/apiClient';
import type { CandidateMemory } from '../../coach/coachApi';
import {
  applyFactRewrite,
  createFactRewriteVariant,
  listFactRewriteVariants,
  revertFactRewrite,
} from '../../resume/experienceFactRewriteApi';
import { forgetSharedRead } from '../../resume/sharedRead';
import { useTextVariants } from '../apply/useTextVariants';
import { VariantSwitch, type VariantControlsState } from '../apply/VariantControls';
import { Icon } from '../kit/Icon';
import { InfoTip } from '../kit/InfoTip';
import { ResultLine } from '../kit/ResultLine';
import { buildNodePath } from '../routes';
import { Link } from '../shell/Link';
import { useScreenChrome } from '../shell/ShellContext';
import type { ChatMessage } from './model';
import { ErrorRow, Message, Reply } from './parts';
import { ResumeEditVariantButton, ResumeEditWish } from './ResumeEditVariant';
import {
  declineResumeEdit,
  loadResumeEdit,
  loadResumeReword,
  type ResumeEdit,
} from './resumeEdit';

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

/** Откуда правка: пункт из факта беседы или, B786, новая формулировка первой строки места. */
export type EditSource =
  | { readonly kind: 'fact'; readonly factId: string }
  | { readonly kind: 'reword'; readonly experienceId: string };

const FACT = 'fact:';
const REWORD = 'reword:';
const sourceKey = (source: EditSource) =>
  source.kind === 'fact' ? `${FACT}${source.factId}` : `${REWORD}${source.experienceId}`;
const loadByKey = (key: string) =>
  key.startsWith(FACT)
    ? loadResumeEdit(key.slice(FACT.length))
    : loadResumeReword(key.slice(REWORD.length));

/** Чтение правки; ответ, пришедший после ухода или смены источника, отбрасывается. */
function useEdit(source: EditSource) {
  const [state, setState] = useState<Loaded>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const key = sourceKey(source);
  useEffect(() => {
    let live = true;
    setState({ kind: 'loading' });
    loadByKey(key)
      .then((edit) => {
        if (!live) return;
        setState(
          edit && 'appliedRewriteId' in edit
            ? { kind: 'applied', rewriteId: edit.appliedRewriteId }
            : { kind: 'ready', edit },
        );
      })
      .catch(() => live && setState({ kind: 'failed' }));
    return () => {
      live = false;
    };
  }, [key, attempt]);
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
function useResumeEdit(source: EditSource) {
  const { state, setState, reload } = useEdit(source);
  const { busy, failure, setFailure, run } = useRun();

  function reread() {
    setFailure(null);
    reload();
  }
  function apply(edit: ResumeEdit, variantId?: string) {
    void run(
      async () => {
        const record = await applyFactRewrite(edit.proposalId, {}, [edit.key], variantId);
        setState({ kind: 'applied', rewriteId: record.id });
      },
      (reason) => ({
        text: 'Правка не применилась',
        retry: isStale(reason) ? reread : () => apply(edit, variantId),
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
  // B786: новая формулировка строки собрана из самой строки и записей о месте — перечень их не нужен.
  if (edit.replaces) return `Новая формулировка первой строки: «${edit.place}».`;
  const facts = edit.sourceFactIds.flatMap((id) => {
    const fact = memory.find((item) => item.id === id && !item.sensitive);
    if (!fact) return [];
    const said = messages.find((item) => fact.sourceMessageIds.includes(item.id));
    const day = said?.at ? ` ${said.at.slice(8, 10)}.${said.at.slice(5, 7)}` : '';
    const from = said ? ` — из беседы${day}` : '';
    const confirmed = said && fact.status === 'confirmed' ? ', запись вы подтвердили: «Верно»' : '';
    return [`«${fact.statement}»${from}${confirmed}.`];
  });
  const head = edit.place ? `Новая строка: «${edit.place}».` : 'Новая строка.';
  return [head, ...facts].join(' ');
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

/** Варианты пункта: показанный текст и его номер; в резюме идёт показанный. */
function useEditVariants(edit: ResumeEdit) {
  const { proposalId, key } = edit;
  const [text, setText] = useState(edit.text);
  const source = useMemo(
    () => ({
      load: (signal: AbortSignal) => listFactRewriteVariants(proposalId, key, signal),
      create: (wish: VariantWish) => createFactRewriteVariant(proposalId, key, wish),
    }),
    [proposalId, key],
  );
  return { text, variants: useTextVariants(source, { draftText: edit.text, text, setText }) };
}

/** «Было → Станет»: на 1440 «Было» блоком, на 390 — свёрнутым «Показать, что было» (k06). */
function EditDiff({ edit, text, reason }: { edit: ResumeEdit; text: string; reason?: string }) {
  return (
    <>
      <p className="ec-title">
        {edit.replaces ? `${edit.place} · первая строка` : edit.place}
        {reason ? <InfoTip label="Причина правки" text={reason} /> : null}
      </p>
      <dl className="ec-diff">
        {edit.before ? (
          <div className="was">
            <dt>Было</dt>
            <dd>{edit.before}</dd>
          </div>
        ) : null}
        <div className="now">
          <dt>Станет</dt>
          <dd aria-live="polite">{text}</dd>
        </div>
      </dl>
      {edit.before ? (
        <details className="ec-was">
          <summary>
            <Icon name="down" />
            Показать, что было
          </summary>
          <p>{edit.before}</p>
        </details>
      ) : null}
    </>
  );
}

interface EditBodyProps {
  readonly edit: ResumeEdit;
  readonly text: string;
  readonly variants: VariantControlsState;
  readonly popId: string;
  readonly reason?: string;
  readonly busy: boolean;
  readonly onApply: () => void;
  readonly onDecline: () => void;
}

function EditBody({ edit, text, variants, popId, reason, busy, onApply, onDecline }: EditBodyProps) {
  const locked = busy || variants.busy;
  return (
    <>
      <EditDiff edit={edit} text={text} reason={reason} />
      <VariantSwitch variants={{ ...variants, locked }} label="Варианты правки" />
      <div className="msg-acts act-row ec-acts">
        <button className="btn is-sm is-primary" type="button" disabled={locked} onClick={onApply}>
          Применить
        </button>
        <ResumeEditVariantButton variants={variants} popId={popId} disabled={locked} />
        <button
          className="btn is-sm is-line ec-ib"
          type="button"
          aria-label="Отклонить"
          disabled={locked}
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

interface EditSectionProps {
  readonly edit: ResumeEdit;
  readonly reason?: string;
  readonly busy: boolean;
  readonly error: ReactNode;
  readonly onApply: (variantId?: string) => void;
  readonly onDecline: () => void;
}

function EditSection({ edit, reason, busy, error, onApply, onDecline }: EditSectionProps) {
  const { text, variants } = useEditVariants(edit);
  const popId = useId();
  const card = useRef<HTMLElement>(null);
  return (
    <section
      className="ec"
      ref={card}
      aria-label={`Правка резюме: ${edit.place}`}
      aria-busy={busy || variants.busy}
    >
      <EditBody
        edit={edit}
        text={text}
        variants={variants}
        popId={popId}
        reason={reason}
        busy={busy}
        onApply={() => onApply(variants.variantId)}
        onDecline={onDecline}
      />
      <ResumeEditWish variants={variants} popId={popId} card={card} />
      {error}
    </section>
  );
}

/** Правка не подготовилась: под ответом понятная строка и повтор, а не «Ответ не пришёл». */
function NotPrepared({ onRetry }: { onRetry: () => void }) {
  return (
    <ErrorRow
      text="Не получилось подготовить правку"
      onRetry={onRetry}
      retryLabel="Попробовать ещё раз"
    />
  );
}

export interface ResumeEditCardProps {
  /** Факт из беседы, который надо показать в резюме, или строка места, которую переписать. */
  readonly source: EditSource;
  readonly reason?: string;
  readonly memory: readonly CandidateMemory[];
  readonly messages: readonly ChatMessage[];
}

/** K6: готовая правка резюме; в резюме она попадает только после «Применить». */
export function ResumeEditCard({ source, reason, memory, messages }: ResumeEditCardProps) {
  const { state, busy, failure, reload, apply, decline, revert } = useResumeEdit(source);
  const error = failure ? <ErrorRow text={failure.text} onRetry={failure.retry} /> : null;
  if (state.kind === 'loading') return <Reply text="" />;
  if (state.kind === 'failed') return <NotPrepared onRetry={reload} />;
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
      <EditSection
        key={`${edit.proposalId}:${edit.key}`}
        edit={edit}
        reason={reason}
        busy={busy}
        error={error}
        onApply={(variantId) => apply(edit, variantId)}
        onDecline={() => decline(edit)}
      />
      <HalfSheet />
    </>
  );
}
