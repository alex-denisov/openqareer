import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { ArrowsClockwise, Check, CheckCircle, Sparkle, Spinner, X } from '@phosphor-icons/react';
import { pluralRu } from '../../../shared/pluralRu';
import {
  rewriteSourceFacts,
  type FactRewriteProposal,
} from '../../../server/domain/experienceFactRewrite';
import { CoachApiError } from '../coach/apiClient';
import type { CandidateMemory } from '../coach/coachApi';
import {
  applyFactRewrite,
  requestFactRewrite,
  revertFactRewrite,
} from './experienceFactRewriteApi';
import type { ResumeDraft } from './resumeTypes';
import './profileExperienceSuggestions.css';
import './profileExperienceFacts.css';

type SectionSave = (next: ResumeDraft) => Promise<boolean | void> | boolean | void;
type Refresh = () => Promise<void> | void;

const NOT_SAVED = 'Не сохранилось: нет связи с сервером. Попробуйте ещё раз.';
/** How long the accepted rewrite keeps its «Отменить правку» in the block. */
const UNDO_WINDOW_MS = 24 * 60 * 60 * 1000;

function messageOf(reason: unknown): string {
  return reason instanceof Error && reason.message ? reason.message : NOT_SAVED;
}

/** Records the candidate's «Отклонить»: the facts stay in memory, they are only not offered again. */
export function declineFacts(draft: ResumeDraft, factIds: readonly string[]): ResumeDraft {
  return {
    ...draft,
    declinedFactIds: [...new Set([...(draft.declinedFactIds ?? []), ...factIds])],
  };
}

/** The last accepted rewrite, while its undo is still offered. */
function recentRewrite(draft: ResumeDraft, now: number) {
  const last = draft.factRewrites?.at(-1);
  return last && now - Date.parse(last.appliedAt) < UNDO_WINDOW_MS ? last : undefined;
}

type ProposalState =
  | { readonly status: 'idle' | 'loading' }
  | { readonly status: 'ready'; readonly proposal: FactRewriteProposal | null }
  | { readonly status: 'failed'; readonly error: string };

/** Changes when the facts on offer or the places do: then the consultant is asked again. */
function useSourceKey(draft: ResumeDraft, memory: readonly CandidateMemory[]): string {
  return useMemo(() => {
    const ids = rewriteSourceFacts(draft, memory).map((fact) => fact.id);
    const places = draft.experience.map((entry) => entry.id);
    return ids.length && places.length ? [...ids, '|', ...places].join(',') : '';
  }, [draft, memory]);
}

/** Asks the consultant once per set of facts on offer; the server keeps the answer. */
function useRewriteProposal(sourceKey: string) {
  const [state, setState] = useState<ProposalState>({ status: 'idle' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!sourceKey) {
      setState({ status: 'ready', proposal: null });
      return undefined;
    }
    let live = true;
    setState({ status: 'loading' });
    requestFactRewrite()
      .then((proposal) => live && setState({ status: 'ready', proposal }))
      .catch((reason: unknown) => live && setState({ status: 'failed', error: messageOf(reason) }));
    return () => {
      live = false;
    };
  }, [sourceKey, attempt]);
  return { state, retry: useCallback(() => setAttempt((value) => value + 1), []) };
}

function useBusyAction() {
  const [busy, setBusy] = useState<'accept' | 'dismiss' | 'revert' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (action: 'accept' | 'dismiss' | 'revert', work: () => Promise<void>) => {
    setBusy(action);
    setError(null);
    try {
      await work();
    } catch (reason) {
      setError(messageOf(reason));
    } finally {
      setBusy(null);
    }
  };
  return { busy, error, run };
}

/** «Принять» and «Отменить правку» change the profile on the server; «Отклонить» is a draft save. */
function useRewriteActions(
  draft: ResumeDraft,
  onSectionSave: SectionSave,
  onProfileChanged?: Refresh,
  onStale?: () => void,
) {
  const actions = useBusyAction();
  const accept = (current: FactRewriteProposal) =>
    void actions.run('accept', async () => {
      try {
        await applyFactRewrite(current.id);
      } catch (reason) {
        // The places changed under the proposal: ask the consultant again.
        if (reason instanceof CoachApiError && reason.code === 'rewrite_stale') onStale?.();
        throw reason;
      }
      await onProfileChanged?.();
    });
  const dismiss = (current: FactRewriteProposal) =>
    void actions.run('dismiss', async () => {
      if ((await onSectionSave(declineFacts(draft, current.sourceFactIds))) === false) {
        throw new Error(NOT_SAVED);
      }
    });
  const revert = (rewriteId: string) =>
    void actions.run('revert', async () => {
      await revertFactRewrite(rewriteId);
      await onProfileChanged?.();
    });
  return { actions, accept, dismiss, revert };
}

function employerOf(draft: ResumeDraft, experienceId: string): string {
  return (
    draft.experience.find((entry) => entry.id === experienceId)?.employer || 'Компания не указана'
  );
}

function leftOutNote(count: number): string | null {
  if (count === 0) return null;
  return `${pluralRu(count, ['факт', 'факта', 'фактов'])} из беседы консультант не взял: они уже есть в профиле, это обрывки речи или оговорки. В резюме они не попадут.`;
}

function ProposalBullets({
  draft,
  proposal,
}: {
  readonly draft: ResumeDraft;
  readonly proposal: FactRewriteProposal;
}) {
  return (
    <div className="profile-experience-suggestions__rows" role="list">
      {proposal.places.map((place) => (
        <div
          key={place.experienceId}
          className="pm-sg-r profile-experience-suggestions__row profile-fact-rewrite__place"
          data-experience-id={place.experienceId}
          role="listitem"
        >
          <span className="profile-experience-suggestions__employer">
            {employerOf(draft, place.experienceId)}
          </span>
          <ul className="profile-fact-rewrite__bullets">
            {place.bullets.map((bullet) => (
              <li key={bullet.text}>
                <span className="career-sr-only">Предлагается: </span>
                <ins>{bullet.text}</ins>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function BlockHeader({ titleId }: { readonly titleId: string }) {
  return (
    <header className="pm-sg-h profile-experience-suggestions__header">
      <Sparkle size={16} weight="regular" aria-hidden="true" />
      <b id={titleId}>
        <span className="profile-experience-suggestions__mobile-title">Пункты из беседы</span>
        <span className="profile-experience-suggestions__desktop-title">
          Консультант переписал рассказанное вами в пункты «Опыта»
        </span>
      </b>
      <span className="profile-experience-suggestions__source">Предложено консультантом</span>
    </header>
  );
}

function ActionButton({
  kind,
  busy,
  disabled,
  onClick,
}: {
  readonly kind: 'accept' | 'dismiss';
  readonly busy: string | null;
  readonly disabled?: boolean;
  readonly onClick: () => void;
}) {
  const accept = kind === 'accept';
  const active = busy === kind;
  const Icon = accept ? Check : X;
  return (
    <button
      type="button"
      className={
        accept
          ? 'career-btn career-inline-ok is-sm pm-cta is-inline profile-experience-suggestions__accept'
          : 'career-btn is-sm pm-text profile-experience-suggestions__dismiss'
      }
      disabled={Boolean(busy) || disabled}
      aria-busy={active || undefined}
      onClick={onClick}
    >
      {active ? (
        <Spinner size={16} weight="regular" aria-hidden="true" />
      ) : (
        <Icon size={16} weight="regular" aria-hidden="true" />
      )}
      {active ? (accept ? 'Применяем…' : 'Отклоняем…') : accept ? 'Принять' : 'Отклонить'}
    </button>
  );
}

function ProposalBody({
  draft,
  proposal,
  actions,
  onAccept,
  onDismiss,
}: {
  readonly draft: ResumeDraft;
  readonly proposal: FactRewriteProposal;
  readonly actions: ReturnType<typeof useBusyAction>;
  readonly onAccept: () => void;
  readonly onDismiss: () => void;
}) {
  const note = leftOutNote(proposal.leftOutFactIds.length);
  return (
    <>
      <ProposalBullets draft={draft} proposal={proposal} />
      {note ? <p className="profile-fact-rewrite__note">{note}</p> : null}
      <div className="pm-sg-a profile-experience-suggestions__actions">
        <ActionButton kind="accept" busy={actions.busy} onClick={onAccept} />
        <ActionButton kind="dismiss" busy={actions.busy} onClick={onDismiss} />
        <p className="profile-experience-suggestions__pending-note">
          Пока вы не примете, в резюме ничего не изменится.
        </p>
      </div>
    </>
  );
}

function AppliedState({
  busy,
  onRevert,
}: {
  readonly busy: boolean;
  readonly onRevert: () => void;
}) {
  return (
    <div className="profile-experience-suggestions__row-state" data-testid="fact-rewrite-applied">
      <span role="status">
        <CheckCircle size={16} weight="regular" aria-hidden="true" />
        Пункты консультанта добавлены в «Опыт».
      </span>
      <button
        type="button"
        className="career-btn is-sm pm-text profile-experience-suggestions__revert"
        disabled={busy}
        aria-busy={busy || undefined}
        onClick={onRevert}
      >
        {busy ? (
          <Spinner size={16} weight="regular" aria-hidden="true" />
        ) : (
          <ArrowsClockwise size={16} weight="regular" aria-hidden="true" />
        )}
        {busy ? 'Отменяем…' : 'Отменить правку'}
      </button>
    </div>
  );
}

function ProposalStatus({
  state,
  onRetry,
}: {
  readonly state: ProposalState;
  readonly onRetry: () => void;
}) {
  if (state.status === 'loading') {
    return (
      <p className="profile-fact-rewrite__note" role="status">
        <Spinner size={16} weight="regular" aria-hidden="true" />
        Консультант переписывает рассказанное вами в пункты резюме…
      </p>
    );
  }
  if (state.status !== 'failed') return null;
  return (
    <div className="profile-fact-rewrite__failed">
      <p className="career-command-error" role="alert">
        {state.error}
      </p>
      <button type="button" className="career-btn is-sm pm-text" onClick={onRetry}>
        <ArrowsClockwise size={16} weight="regular" aria-hidden="true" />
        Повторить
      </button>
    </div>
  );
}

export interface ExperienceFactRewriteProps {
  readonly draft: ResumeDraft;
  readonly memory: readonly CandidateMemory[];
  readonly onSectionSave: SectionSave;
  /** Re-reads the profile after the server changed it (accept, undo). */
  readonly onProfileChanged?: Refresh;
  readonly now?: () => number;
}

/**
 * What the candidate told the consultant reaches «Опыт» only as the
 * consultant's bullets (owner, 29.10): one block, one «Принять» for all
 * places. The candidate's own words stay in memory and are never shown here.
 */
export function ExperienceFactRewrite({
  draft,
  memory,
  onSectionSave,
  onProfileChanged,
  now = Date.now,
}: ExperienceFactRewriteProps) {
  const titleId = useId();
  const sourceKey = useSourceKey(draft, memory);
  const { state, retry } = useRewriteProposal(sourceKey);
  const { actions, accept, dismiss, revert } = useRewriteActions(
    draft,
    onSectionSave,
    onProfileChanged,
    retry,
  );
  const applied = recentRewrite(draft, now());
  // A proposal without bullets offers nothing to accept: it is not shown at all.
  const proposal =
    state.status === 'ready' && state.proposal?.places.length ? state.proposal : null;
  if (!sourceKey && !applied) return null;
  if (sourceKey && state.status === 'ready' && !proposal && !applied) return null;

  return (
    <section
      className="career-consultant-suggestion pm-suggest profile-experience-suggestions profile-fact-rewrite"
      aria-labelledby={titleId}
      aria-busy={Boolean(actions.busy) || state.status === 'loading' || undefined}
      data-testid="experience-fact-rewrite"
    >
      <BlockHeader titleId={titleId} />
      {applied ? (
        <AppliedState busy={actions.busy === 'revert'} onRevert={() => revert(applied.id)} />
      ) : null}
      {sourceKey ? <ProposalStatus state={state} onRetry={retry} /> : null}
      {proposal ? (
        <ProposalBody
          draft={draft}
          proposal={proposal}
          actions={actions}
          onAccept={() => accept(proposal)}
          onDismiss={() => dismiss(proposal)}
        />
      ) : null}
      {actions.error ? (
        <p className="career-command-error profile-experience-suggestions__error" role="alert">
          {actions.error}
        </p>
      ) : null}
    </section>
  );
}
