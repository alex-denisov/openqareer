import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { ArrowsClockwise, Check, Sparkle, Spinner, X } from '@phosphor-icons/react';
import { pluralRu } from '../../../shared/pluralRu';
import {
  rewriteSourceFacts,
  type FactRewriteProposal,
} from '../../../server/domain/experienceFactRewrite';
import { CoachApiError } from '../coach/apiClient';
import type { CandidateMemory } from '../coach/coachApi';
import { applyFactRewrite, requestFactRewrite } from './experienceFactRewriteApi';
import { hasBulletsLeft, ProposalBullets, type BulletEdits } from './ProfileFactRewriteBullets';
import type { ResumeDraft } from './resumeTypes';
import './profileExperienceSuggestions.css';
import './profileExperienceFacts.css';

type SectionSave = (next: ResumeDraft) => Promise<boolean | void> | boolean | void;
type Refresh = () => Promise<void> | void;

const NOT_SAVED = 'Не сохранилось: нет связи с сервером. Попробуйте ещё раз.';

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
  useServerChanges(sourceKey, state, setState);
  return { state, retry: useCallback(() => setAttempt((value) => value + 1), []) };
}

/**
 * The server may change a kept proposal while «Опыт» stays open (01.11: it
 * translated the owner's bullets into the profile's language, and the .app
 * went on showing the Russian ones). When the window is back, the proposal is
 * read again quietly; a new one replaces what is shown, a failed read keeps it.
 */
function useServerChanges(
  sourceKey: string,
  state: ProposalState,
  setState: (next: ProposalState) => void,
) {
  const shownId = state.status === 'ready' ? (state.proposal?.id ?? null) : undefined;
  useEffect(() => {
    if (!sourceKey || shownId === undefined) return undefined;
    let live = true;
    let reading = false;
    const reread = () => {
      if (reading || document.visibilityState === 'hidden') return;
      reading = true;
      requestFactRewrite()
        .then((proposal) => {
          if (live && (proposal?.id ?? null) !== shownId) setState({ status: 'ready', proposal });
        })
        // The shown proposal stays; «Принять» on a stale one answers rewrite_stale and asks again.
        .catch(() => undefined)
        .finally(() => {
          reading = false;
        });
    };
    window.addEventListener('focus', reread);
    document.addEventListener('visibilitychange', reread);
    return () => {
      live = false;
      window.removeEventListener('focus', reread);
      document.removeEventListener('visibilitychange', reread);
    };
  }, [sourceKey, shownId, setState]);
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
  const accept = (current: FactRewriteProposal, edits: BulletEdits) =>
    void actions.run('accept', async () => {
      try {
        await applyFactRewrite(current.id, edits);
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
  return { actions, accept, dismiss };
}

function leftOutNote(count: number): string | null {
  if (count === 0) return null;
  return `${pluralRu(count, ['факт', 'факта', 'фактов'])} из беседы консультант не взял: они уже есть в профиле, это обрывки речи или оговорки. В резюме они не попадут.`;
}

function BlockHeader({ titleId }: { readonly titleId: string }) {
  return (
    <header className="pm-sg-h profile-experience-suggestions__header">
      <Sparkle size={16} weight="regular" aria-hidden="true" />
      <b id={titleId}>Пункты из беседы</b>
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
  readonly onAccept: (edits: BulletEdits) => void;
  readonly onDismiss: () => void;
}) {
  const [edits, setEdits] = useState<BulletEdits>({});
  const note = leftOutNote(proposal.leftOutFactIds.length);
  return (
    <>
      <ProposalBullets
        draft={draft}
        proposal={proposal}
        edits={edits}
        busy={Boolean(actions.busy)}
        onChange={(key, text) => setEdits((current) => ({ ...current, [key]: text }))}
      />
      {note ? <p className="profile-fact-rewrite__note">{note}</p> : null}
      <div className="pm-sg-a profile-experience-suggestions__actions">
        <ActionButton
          kind="accept"
          busy={actions.busy}
          disabled={!hasBulletsLeft(proposal, edits)}
          onClick={() => onAccept(edits)}
        />
        <ActionButton kind="dismiss" busy={actions.busy} onClick={onDismiss} />
        <p className="profile-experience-suggestions__pending-note">
          Пока вы не примете, в резюме ничего не изменится.
        </p>
      </div>
    </>
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
}: ExperienceFactRewriteProps) {
  const titleId = useId();
  const sourceKey = useSourceKey(draft, memory);
  const { state, retry } = useRewriteProposal(sourceKey);
  const { actions, accept, dismiss } = useRewriteActions(
    draft,
    onSectionSave,
    onProfileChanged,
    retry,
  );
  // A proposal without bullets offers nothing to accept: it is not shown at all.
  const proposal =
    state.status === 'ready' && state.proposal?.places.length ? state.proposal : null;
  // An accepted rewrite is undone from «История изменений» (owner, 02.11), not from a banner here.
  if (!sourceKey || (state.status === 'ready' && !proposal)) return null;

  return (
    <section
      className="career-consultant-suggestion pm-suggest profile-experience-suggestions profile-fact-rewrite"
      aria-labelledby={titleId}
      aria-busy={Boolean(actions.busy) || state.status === 'loading' || undefined}
      data-testid="experience-fact-rewrite"
    >
      <BlockHeader titleId={titleId} />
      {sourceKey ? <ProposalStatus state={state} onRetry={retry} /> : null}
      {proposal ? (
        <ProposalBody
          key={proposal.id}
          draft={draft}
          proposal={proposal}
          actions={actions}
          onAccept={(edits) => accept(proposal, edits)}
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
