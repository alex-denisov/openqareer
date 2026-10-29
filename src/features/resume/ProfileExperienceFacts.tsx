import { useId, useMemo, useState } from 'react';
import { Check, Question, X } from '@phosphor-icons/react';
import { pluralRu } from '../../../shared/pluralRu';
import type { CandidateMemory } from '../coach/coachApi';
import {
  acceptFactPlacements,
  declineFacts,
  placeExperienceFacts,
} from './experienceFactPlacement';
import type { InlineSuggestionItem } from './InlineConsultantSuggestion';
import { provenanceLabel } from './profileProvenance';
import type { ResumeDraft } from './resumeTypes';
import './profileExperienceFacts.css';

type SectionSave = (next: ResumeDraft) => Promise<boolean | void> | boolean | void;
type SuggestionHandler = (suggestion: InlineSuggestionItem) => Promise<void> | void;

const NOT_SAVED = 'Не сохранилось: нет связи с сервером. Попробуйте ещё раз.';
const FACT_PREFIX = 'fact:';
const PENDING_PREVIEW = 5;

async function saveOrThrow(save: SectionSave, next: ResumeDraft): Promise<void> {
  if ((await save(next)) === false) throw new Error(NOT_SAVED);
}

async function eachCommand(items: readonly InlineSuggestionItem[], handler?: SuggestionHandler) {
  if (!handler) return;
  for (const item of items) await handler(item);
}

export interface ExperienceFactProposals {
  readonly suggestions: readonly InlineSuggestionItem[];
  readonly pending: readonly CandidateMemory[];
  /** Whether any fact is proposed, so the group buttons are live even without commands. */
  readonly hasFacts: boolean;
  readonly acceptGroup: (items: readonly InlineSuggestionItem[]) => Promise<void>;
  readonly dismissGroup: (items: readonly InlineSuggestionItem[]) => Promise<void>;
}

function splitFacts(items: readonly InlineSuggestionItem[]) {
  return {
    facts: items.filter((item) => item.factMemoryId),
    commands: items.filter((item) => !item.factMemoryId),
  };
}

/** One draft write for all facts; the consultant's own proposals still go one by one. */
function factGroupHandlers(
  draft: ResumeDraft,
  onSectionSave: SectionSave,
  commands: { readonly accept?: SuggestionHandler; readonly dismiss?: SuggestionHandler },
): Pick<ExperienceFactProposals, 'acceptGroup' | 'dismissGroup'> {
  return {
    acceptGroup: async (items) => {
      const split = splitFacts(items);
      await eachCommand(split.commands, commands.accept);
      if (split.facts.length === 0) return;
      const placements = split.facts.map((item) => ({
        experienceId: item.experienceId ?? '',
        factId: item.factMemoryId ?? '',
      }));
      await saveOrThrow(onSectionSave, acceptFactPlacements(draft, placements));
    },
    dismissGroup: async (items) => {
      const split = splitFacts(items);
      await eachCommand(split.commands, commands.dismiss);
      if (split.facts.length === 0) return;
      const ids = split.facts.map((item) => item.factMemoryId ?? '');
      await saveOrThrow(onSectionSave, declineFacts(draft, ids));
    },
  };
}

/**
 * Conversation facts join the consultant's «Опыт» proposals (mockup 2): one
 * row per fact under its employer, accepted or declined with the rest.
 */
export function useExperienceFactProposals(options: {
  readonly draft: ResumeDraft;
  readonly memory: readonly CandidateMemory[];
  readonly suggestions: readonly InlineSuggestionItem[];
  readonly onSectionSave: SectionSave;
  readonly onAcceptSuggestion?: SuggestionHandler;
  readonly onDismissSuggestion?: SuggestionHandler;
}): ExperienceFactProposals {
  const { draft, memory, onSectionSave } = options;
  const placement = useMemo(() => placeExperienceFacts(draft, memory), [draft, memory]);
  const factSuggestions = placement.proposals.map(
    ({ experienceId, fact }): InlineSuggestionItem => ({
      id: `${FACT_PREFIX}${fact.id}`,
      section: 'experience',
      experienceId,
      proposedText: fact.statement,
      factMemoryId: fact.id,
    }),
  );
  return {
    suggestions: [...options.suggestions, ...factSuggestions],
    pending: placement.pending,
    hasFacts: factSuggestions.length > 0,
    ...factGroupHandlers(draft, onSectionSave, {
      accept: options.onAcceptSuggestion,
      dismiss: options.onDismissSuggestion,
    }),
  };
}

function placeLabel(entry: ResumeDraft['experience'][number]): string {
  const period = [entry.startDate, entry.current ? 'по н. в.' : entry.endDate]
    .filter(Boolean)
    .join(' — ');
  return [entry.employer || 'Компания не указана', period].filter(Boolean).join(' · ');
}

function useDraftSave(onSectionSave: SectionSave) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (next: ResumeDraft) => {
    setBusy(true);
    setError(null);
    try {
      await saveOrThrow(onSectionSave, next);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : NOT_SAVED);
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}

function PlaceSelect({
  draft,
  value,
  disabled,
  onChange,
}: {
  readonly draft: ResumeDraft;
  readonly value: string;
  readonly disabled: boolean;
  readonly onChange: (experienceId: string) => void;
}) {
  const selectId = useId();
  return (
    <>
      <label className="career-sr-only" htmlFor={selectId}>
        Место работы для факта
      </label>
      <select
        id={selectId}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">Выберите место работы</option>
        {draft.experience.map((entry) => (
          <option key={entry.id} value={entry.id}>
            {placeLabel(entry)}
          </option>
        ))}
      </select>
    </>
  );
}

function PendingFactRow({
  fact,
  draft,
  onSectionSave,
}: {
  readonly fact: CandidateMemory;
  readonly draft: ResumeDraft;
  readonly onSectionSave: SectionSave;
}) {
  const [experienceId, setExperienceId] = useState('');
  const { busy, error, run } = useDraftSave(onSectionSave);
  return (
    <li className="profile-pending-fact" data-fact-id={fact.id}>
      <p className="profile-pending-fact__text">{fact.statement}</p>
      <span className="profile-pending-fact__source">{provenanceLabel(fact.provenance)}</span>
      <div className="profile-pending-fact__actions">
        <PlaceSelect
          draft={draft}
          value={experienceId}
          disabled={busy}
          onChange={setExperienceId}
        />
        <button
          type="button"
          className="career-btn is-sm pm-cta is-inline"
          disabled={busy || !experienceId}
          onClick={() => void run(acceptFactPlacements(draft, [{ experienceId, factId: fact.id }]))}
        >
          <Check size={16} aria-hidden="true" />
          Добавить
        </button>
        <button
          type="button"
          className="career-btn is-sm pm-text"
          disabled={busy}
          onClick={() => void run(declineFacts(draft, [fact.id]))}
        >
          <X size={16} aria-hidden="true" />
          Отклонить
        </button>
      </div>
      {error ? (
        <p className="career-command-error" role="alert">
          {error}
        </p>
      ) : null}
    </li>
  );
}

function pendingTitle(count: number): string {
  const verb = count % 10 === 1 && count % 100 !== 11 ? 'ждёт' : 'ждут';
  return `${pluralRu(count, ['факт', 'факта', 'фактов'])} ${verb} подтверждения`;
}

/**
 * Facts from the conversation no workplace could be found for (C10): the
 * candidate picks the place or declines. Nothing enters the resume unasked.
 */
export function ProfileExperiencePendingFacts({
  draft,
  pending,
  onSectionSave,
}: {
  readonly draft: ResumeDraft;
  readonly pending: readonly CandidateMemory[];
  readonly onSectionSave: SectionSave;
}) {
  const titleId = useId();
  const [all, setAll] = useState(false);
  if (pending.length === 0 || draft.experience.length === 0) return null;
  const visible = all ? pending : pending.slice(0, PENDING_PREVIEW);
  return (
    <section
      className="profile-pending-facts"
      aria-labelledby={titleId}
      data-testid="pending-experience-facts"
    >
      <header className="profile-pending-facts__header">
        <Question size={16} aria-hidden="true" />
        <b id={titleId}>{pendingTitle(pending.length)}</b>
      </header>
      <p className="profile-pending-facts__note">
        Из беседы с консультантом. Выберите место работы, и факт войдёт в него.
      </p>
      <ul className="profile-pending-facts__list">
        {visible.map((fact) => (
          <PendingFactRow key={fact.id} fact={fact} draft={draft} onSectionSave={onSectionSave} />
        ))}
      </ul>
      {pending.length > PENDING_PREVIEW ? (
        <button
          type="button"
          className="profile-skill-disclosure"
          aria-expanded={all}
          onClick={() => setAll((current) => !current)}
        >
          {all ? 'Свернуть' : `Показать все ${pending.length}`}
        </button>
      ) : null}
    </section>
  );
}
