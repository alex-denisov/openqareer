import { ArrowsClockwise, Check, CheckCircle, Sparkle, Spinner, X } from '@phosphor-icons/react';
import { APPLIED_SUGGESTION_NOTE } from './InlineConsultantSuggestion';
import { useId, useRef, useState } from 'react';
import type { ResumeDraft } from './resumeTypes';
import type { InlineSuggestionItem } from './InlineConsultantSuggestion';
import { teamSizeLabel } from './ProfileTeamSizeTag';
import './profileExperienceSuggestions.css';

export interface ProfileExperienceSuggestionsProps {
  readonly draft: ResumeDraft;
  readonly suggestions?: readonly InlineSuggestionItem[];
  readonly onAcceptSuggestion?: (suggestion: InlineSuggestionItem) => Promise<void> | void;
  readonly onDismissSuggestion?: (suggestion: InlineSuggestionItem) => Promise<void> | void;
  readonly onRevertSuggestion?: (suggestion: InlineSuggestionItem) => Promise<void> | void;
  /** Takes the whole pending list at once, so many facts are one save instead of one each (C10). */
  readonly onAcceptGroup?: GroupHandler;
  readonly onDismissGroup?: GroupHandler;
}

type GroupHandler = (suggestions: readonly InlineSuggestionItem[]) => Promise<void> | void;

interface ExperienceSuggestionGroup {
  readonly key: string;
  readonly employer: string;
  readonly suggestions: readonly InlineSuggestionItem[];
}

type GroupAction = 'accept' | 'dismiss';

const UNKNOWN_EMPLOYER = 'Компания не указана';

function groupSuggestionsByEmployer(
  suggestions: readonly InlineSuggestionItem[],
  draft: ResumeDraft,
): readonly ExperienceSuggestionGroup[] {
  const experienceById = new Map(draft.experience.map((entry) => [entry.id, entry]));
  const groups = new Map<string, { employer: string; suggestions: InlineSuggestionItem[] }>();

  for (const suggestion of suggestions) {
    if (suggestion.section !== 'experience') continue;
    const employer =
      experienceById.get(suggestion.experienceId ?? '')?.employer?.trim() || UNKNOWN_EMPLOYER;
    const employerKey =
      employer === UNKNOWN_EMPLOYER
        ? suggestion.experienceId
          ? `experience:${suggestion.experienceId}`
          : `suggestion:${suggestion.id}`
        : `employer:${employer.normalize('NFKC').toLocaleLowerCase('ru-RU')}`;
    const group = groups.get(employerKey) ?? { employer, suggestions: [] };
    group.suggestions.push(suggestion);
    groups.set(employerKey, group);
  }

  return [...groups].map(([key, group]) => ({ key, ...group }));
}

function actionError(reason: unknown, fallback: string): string {
  if (reason instanceof Error && reason.message.trim()) return reason.message;
  return fallback;
}

type ActionLock = { current: boolean };
type ActionHandler = (suggestion: InlineSuggestionItem) => Promise<void> | void;
type SequentialResult = { readonly ok: true } | { readonly ok: false; readonly reason: unknown };

interface SuggestionActionState {
  readonly busyAction: GroupAction | null;
  readonly busyRevertId: string | null;
  readonly error: string | null;
  readonly isBusy: boolean;
  readonly handleGroupAction: (action: GroupAction) => Promise<void>;
  readonly handleRevert: (suggestion: InlineSuggestionItem) => Promise<void>;
}

async function runSequentially(
  suggestions: readonly InlineSuggestionItem[],
  handler: ActionHandler,
): Promise<SequentialResult> {
  try {
    for (const suggestion of suggestions) await handler(suggestion);
    return { ok: true };
  } catch (reason) {
    return { ok: false, reason };
  }
}

async function runGroup(
  suggestions: readonly InlineSuggestionItem[],
  groupHandler: GroupHandler,
): Promise<SequentialResult> {
  try {
    await groupHandler(suggestions);
    return { ok: true };
  } catch (reason) {
    return { ok: false, reason };
  }
}

async function performGroupAction(options: {
  readonly action: GroupAction;
  readonly suggestions: readonly InlineSuggestionItem[];
  readonly handler?: ActionHandler;
  readonly groupHandler?: GroupHandler;
  readonly lock: ActionLock;
  readonly setBusyAction: (action: GroupAction | null) => void;
  readonly setError: (error: string | null) => void;
}) {
  const { action, suggestions, handler, groupHandler, lock, setBusyAction, setError } = options;
  if ((!handler && !groupHandler) || !suggestions.length || lock.current) return;

  lock.current = true;
  setBusyAction(action);
  setError(null);
  try {
    const result = groupHandler
      ? await runGroup(suggestions, groupHandler)
      : await runSequentially(suggestions, handler as ActionHandler);
    if (!result.ok) {
      setError(
        actionError(
          result.reason,
          action === 'accept'
            ? 'Не удалось применить все правки. Попробуйте ещё раз.'
            : 'Не удалось отклонить все правки. Попробуйте ещё раз.',
        ),
      );
    }
  } finally {
    lock.current = false;
    setBusyAction(null);
  }
}

async function performRevert(options: {
  readonly suggestion: InlineSuggestionItem;
  readonly handler?: ActionHandler;
  readonly lock: ActionLock;
  readonly setBusyRevertId: (id: string | null) => void;
  readonly setError: (error: string | null) => void;
}) {
  const { suggestion, handler, lock, setBusyRevertId, setError } = options;
  if (!handler || lock.current) return;

  lock.current = true;
  setBusyRevertId(suggestion.id);
  setError(null);
  try {
    await handler(suggestion);
  } catch (reason) {
    setError(actionError(reason, 'Не удалось отменить правку. Попробуйте ещё раз.'));
  } finally {
    lock.current = false;
    setBusyRevertId(null);
  }
}

function useSuggestionActionState(
  suggestions: readonly InlineSuggestionItem[],
  onAcceptSuggestion?: ActionHandler,
  onDismissSuggestion?: ActionHandler,
  onRevertSuggestion?: ActionHandler,
  groupHandlers: { readonly accept?: GroupHandler; readonly dismiss?: GroupHandler } = {},
): SuggestionActionState {
  const lock = useRef(false);
  const [busyAction, setBusyAction] = useState<GroupAction | null>(null);
  const [busyRevertId, setBusyRevertId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isBusy = busyAction !== null || busyRevertId !== null;
  const handleGroupAction = (action: GroupAction) =>
    performGroupAction({
      action,
      suggestions,
      handler: action === 'accept' ? onAcceptSuggestion : onDismissSuggestion,
      groupHandler: action === 'accept' ? groupHandlers.accept : groupHandlers.dismiss,
      lock,
      setBusyAction,
      setError,
    });
  const handleRevert = (suggestion: InlineSuggestionItem) =>
    performRevert({ suggestion, handler: onRevertSuggestion, lock, setBusyRevertId, setError });

  return { busyAction, busyRevertId, error, isBusy, handleGroupAction, handleRevert };
}

function SuggestionHeader({ titleId }: { readonly titleId: string }) {
  return (
    <header className="pm-sg-h profile-experience-suggestions__header">
      <Sparkle size={16} weight="regular" aria-hidden="true" />
      <b id={titleId}>
        <span className="profile-experience-suggestions__mobile-title">Правки консультанта</span>
        <span className="profile-experience-suggestions__desktop-title">
          Консультант предлагает правки блока «Опыт»
        </span>
      </b>
      <span className="profile-experience-suggestions__source">Предложено консультантом</span>
    </header>
  );
}

function AppliedRowState({
  suggestion,
  busy,
  onRevert,
}: {
  readonly suggestion: InlineSuggestionItem;
  readonly busy: boolean;
  readonly onRevert?: (suggestion: InlineSuggestionItem) => Promise<void>;
}) {
  const reverting = busy && Boolean(onRevert);
  return (
    <div className="profile-experience-suggestions__row-state">
      <span role="status">
        <CheckCircle size={16} weight="regular" aria-hidden="true" />
        {APPLIED_SUGGESTION_NOTE}
      </span>
      {onRevert ? (
        <button
          type="button"
          className="career-btn is-sm pm-text profile-experience-suggestions__revert"
          onClick={() => void onRevert(suggestion)}
          disabled={busy}
          aria-busy={reverting || undefined}
        >
          {reverting ? (
            <Spinner size={16} weight="regular" aria-hidden="true" />
          ) : (
            <ArrowsClockwise size={16} weight="regular" aria-hidden="true" />
          )}
          {reverting ? 'Отменяем…' : 'Отменить правку'}
        </button>
      ) : null}
    </div>
  );
}

const FIELD_PREFIX = {
  startDate: 'начало: ',
  endDate: 'окончание: ',
  teamSize: 'Размер команды: ',
} as const;

function displayedSuggestionText(suggestion: InlineSuggestionItem, value: string): string {
  if (!suggestion.field) return value;
  if (suggestion.field === 'teamSize') {
    const size = Number(value);
    return Number.isInteger(size) && size > 0 ? teamSizeLabel(size) : 'неизвестно';
  }
  return /^(\d{4})-(\d{2})(?:-(\d{2}))?$/u.test(value)
    ? value.split('-').reverse().join('.')
    : value;
}

function SuggestionRow({
  group,
  suggestion,
  isBusy,
  busyRevertId,
  onRevert,
}: {
  readonly group: ExperienceSuggestionGroup;
  readonly suggestion: InlineSuggestionItem;
  readonly isBusy: boolean;
  readonly busyRevertId: string | null;
  readonly onRevert?: (suggestion: InlineSuggestionItem) => Promise<void>;
}) {
  return (
    <div
      className="pm-sg-r profile-experience-suggestions__row"
      key={suggestion.id}
      data-suggestion-id={suggestion.id}
      role="listitem"
    >
      <span className="profile-experience-suggestions__employer">{group.employer}</span>
      <span className="profile-experience-suggestions__change">
        {suggestion.field ? <span>{FIELD_PREFIX[suggestion.field]}</span> : null}
        {suggestion.currentText !== undefined ? (
          <>
            <span className="career-sr-only">Сейчас: </span>
            <del>{displayedSuggestionText(suggestion, suggestion.currentText)}</del>{' '}
          </>
        ) : null}
        <span className="career-sr-only">Предлагается: </span>
        <ins>{displayedSuggestionText(suggestion, suggestion.proposedText)}</ins>
      </span>
      {suggestion.applied ? (
        <AppliedRowState
          suggestion={suggestion}
          busy={isBusy && busyRevertId === suggestion.id}
          onRevert={onRevert}
        />
      ) : null}
    </div>
  );
}

function SuggestionRows({
  groups,
  actions,
  canRevert,
}: {
  readonly groups: readonly ExperienceSuggestionGroup[];
  readonly actions: SuggestionActionState;
  readonly canRevert: boolean;
}) {
  return (
    <div className="profile-experience-suggestions__rows" role="list">
      {groups.flatMap((group) =>
        group.suggestions.map((suggestion) => (
          <SuggestionRow
            group={group}
            suggestion={suggestion}
            isBusy={actions.isBusy}
            busyRevertId={actions.busyRevertId}
            onRevert={canRevert ? actions.handleRevert : undefined}
            key={suggestion.id}
          />
        )),
      )}
    </div>
  );
}

function GroupActionButton({
  action,
  busyAction,
  isBusy,
  disabled,
  onClick,
}: {
  readonly action: GroupAction;
  readonly busyAction: GroupAction | null;
  readonly isBusy: boolean;
  readonly disabled: boolean;
  readonly onClick: () => void;
}) {
  const active = busyAction === action;
  const accept = action === 'accept';
  const Icon = accept ? Check : X;
  return (
    <button
      type="button"
      className={
        accept
          ? 'career-btn career-inline-ok is-sm pm-cta is-inline profile-experience-suggestions__accept'
          : 'career-btn is-sm pm-text profile-experience-suggestions__dismiss'
      }
      onClick={onClick}
      disabled={disabled || isBusy}
      aria-busy={active || undefined}
    >
      {active ? (
        <Spinner size={16} weight="regular" aria-hidden="true" />
      ) : (
        <Icon
          className="profile-experience-suggestions__static-icon"
          size={16}
          weight="regular"
          aria-hidden="true"
        />
      )}
      {active ? (accept ? 'Применяем…' : 'Отклоняем…') : accept ? 'Принять' : 'Отклонить'}
    </button>
  );
}

function SuggestionActions({
  actions,
  canAccept,
  canDismiss,
  hasApplied,
}: {
  readonly actions: SuggestionActionState;
  readonly canAccept: boolean;
  readonly canDismiss: boolean;
  readonly hasApplied: boolean;
}) {
  return (
    <div className="pm-sg-a profile-experience-suggestions__actions">
      <GroupActionButton
        action="accept"
        busyAction={actions.busyAction}
        isBusy={actions.isBusy}
        disabled={!canAccept}
        onClick={() => void actions.handleGroupAction('accept')}
      />
      <GroupActionButton
        action="dismiss"
        busyAction={actions.busyAction}
        isBusy={actions.isBusy}
        disabled={!canDismiss}
        onClick={() => void actions.handleGroupAction('dismiss')}
      />
      <p className="profile-experience-suggestions__pending-note">
        {hasApplied
          ? 'Непринятые правки не изменят резюме, пока вы их не примете.'
          : 'Пока вы не примете, в резюме ничего не изменится.'}
      </p>
    </div>
  );
}

function SuggestionError({ message }: { readonly message: string }) {
  return (
    <p className="career-command-error profile-experience-suggestions__error" role="alert">
      {message}
    </p>
  );
}

export function ProfileExperienceSuggestions({
  draft,
  suggestions = [],
  onAcceptSuggestion,
  onDismissSuggestion,
  onRevertSuggestion,
  onAcceptGroup,
  onDismissGroup,
}: ProfileExperienceSuggestionsProps) {
  const titleId = useId();
  const experienceSuggestions = suggestions.filter((item) => item.section === 'experience');
  const pendingSuggestions = experienceSuggestions.filter((item) => !item.applied);
  const groups = groupSuggestionsByEmployer(experienceSuggestions, draft);
  const actions = useSuggestionActionState(
    pendingSuggestions,
    onAcceptSuggestion,
    onDismissSuggestion,
    onRevertSuggestion,
    { accept: onAcceptGroup, dismiss: onDismissGroup },
  );

  if (!experienceSuggestions.length) return null;

  return (
    <div
      className="career-consultant-suggestion pm-suggest profile-experience-suggestions"
      role="region"
      aria-labelledby={titleId}
      aria-busy={actions.isBusy || undefined}
    >
      <SuggestionHeader titleId={titleId} />
      <SuggestionRows groups={groups} actions={actions} canRevert={Boolean(onRevertSuggestion)} />
      {actions.error ? <SuggestionError message={actions.error} /> : null}
      {pendingSuggestions.length ? (
        <SuggestionActions
          actions={actions}
          canAccept={Boolean(onAcceptGroup ?? onAcceptSuggestion)}
          canDismiss={Boolean(onDismissGroup ?? onDismissSuggestion)}
          hasApplied={experienceSuggestions.some((item) => item.applied)}
        />
      ) : null}
    </div>
  );
}
