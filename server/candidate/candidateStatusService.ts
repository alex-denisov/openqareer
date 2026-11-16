import { randomUUID } from 'node:crypto';
import {
  CANDIDATE_STATUS_OPTIONS,
  candidateStatusLabel,
  candidateStatusTitle,
  DEFAULT_CANDIDATE_STATUS,
  type CandidateStatusPreview,
  type CandidateStatusRevert,
  type CandidateStatusState,
  type CandidateStatusToday,
} from '../../shared/candidateStatus';
import type { SqliteProfileChangeLogRepository } from '../data/sqliteProfileChangeLogRepository';
import {
  buildStatusPreview,
  revertDeadline,
  shouldPauseAutoApply,
  todayModulesFor,
  type StatusChangeOptions,
  type StatusChoice,
} from '../domain/candidateStatus';
import type { AutomationPausePort } from './automationPausePort';
import type {
  CandidateStatusChange,
  SqliteCandidateStatusRepository,
} from './sqliteCandidateStatusRepository';

export const STATUS_HISTORY_SECTION = 'status';
const STATUS_HISTORY_LABEL = 'Статус';

export interface CandidateStatusDeps {
  readonly repository: SqliteCandidateStatusRepository;
  readonly automationPause: AutomationPausePort;
  readonly changeLog: Pick<SqliteProfileChangeLogRepository, 'record' | 'markReverted'>;
}

export class StatusUnchangedError extends Error {
  constructor() {
    super('Этот статус уже выбран.');
  }
}

export class StatusRevertUnavailableError extends Error {
  constructor() {
    super('Вернуть прежний статус можно до конца дня, в который вы его сменили.');
  }
}

function choiceOf(change: CandidateStatusChange | null): StatusChoice {
  return change
    ? { status: change.status, targetProfession: change.targetProfession }
    : { status: DEFAULT_CANDIDATE_STATUS, targetProfession: null };
}

function titleOf(choice: StatusChoice): string {
  return candidateStatusTitle(choice.status, choice.targetProfession);
}

function revertOf(change: CandidateStatusChange | null, now: Date): CandidateStatusRevert | null {
  if (!change || new Date(change.revertUntil).getTime() <= now.getTime()) return null;
  return {
    changeId: change.id,
    previousStatus: change.previousStatus,
    previousTitle: candidateStatusTitle(change.previousStatus, change.previousTargetProfession),
    until: change.revertUntil,
  };
}

export function readCandidateStatus(
  deps: Pick<CandidateStatusDeps, 'repository'>,
  candidateId: string,
  now: Date,
): CandidateStatusState {
  const history = deps.repository.history(candidateId);
  const latest = history[0] ?? null;
  const choice = choiceOf(latest);
  return {
    current: {
      status: choice.status,
      label: candidateStatusLabel(choice.status),
      title: titleOf(choice),
      targetProfession: choice.targetProfession,
      since: latest?.createdAt ?? null,
      chosen: latest !== null,
    },
    statuses: CANDIDATE_STATUS_OPTIONS,
    history: history.map((change) => ({
      id: change.id,
      status: change.status,
      title: titleOf(choiceOf(change)),
      since: change.createdAt,
    })),
    revert: revertOf(latest, now),
  };
}

export function previewCandidateStatus(
  deps: Pick<CandidateStatusDeps, 'repository' | 'automationPause'>,
  candidateId: string,
  to: StatusChoice,
  now: Date,
): CandidateStatusPreview {
  const latest = deps.repository.current(candidateId);
  return buildStatusPreview(choiceOf(latest), to, {
    autoApplyPaused: deps.automationPause.isPaused(candidateId, now),
  });
}

export interface StatusChangeInput {
  readonly candidateId: string;
  readonly to: StatusChoice;
  readonly options: StatusChangeOptions;
  readonly now: Date;
  readonly timezone: string;
}

export interface StatusChangeResult {
  readonly state: CandidateStatusState;
  readonly applied: { readonly pauseAutoApply: boolean };
}

/** Статус меняется только здесь и только по запросу самого кандидата. */
export function changeCandidateStatus(
  deps: CandidateStatusDeps,
  input: StatusChangeInput,
): StatusChangeResult {
  const { candidateId, to, now } = input;
  const latest = deps.repository.current(candidateId);
  const from = choiceOf(latest);
  if (latest && from.status === to.status && from.targetProfession === to.targetProfession) {
    throw new StatusUnchangedError();
  }
  const pause =
    shouldPauseAutoApply(to.status, input.options) &&
    !deps.automationPause.isPaused(candidateId, now);
  const snapshot = pause ? deps.automationPause.pause(candidateId, now) : null;
  const id = randomUUID();
  const createdAt = now.toISOString();
  try {
    deps.repository.record({
      id,
      candidateId,
      status: to.status,
      targetProfession: to.targetProfession,
      previousStatus: from.status,
      previousTargetProfession: from.targetProfession,
      applied: { autoApplyPause: snapshot },
      createdAt,
      revertUntil: revertDeadline(now, input.timezone),
    });
    deps.changeLog.record({
      id,
      candidateId,
      actor: 'candidate',
      section: STATUS_HISTORY_SECTION,
      itemId: null,
      label: STATUS_HISTORY_LABEL,
      previous: titleOf(from),
      applied: titleOf(to),
      commandId: null,
      createdAt,
    });
  } catch (error) {
    // Статус не сохранился — пауза, поставленная этой сменой, не должна остаться.
    deps.repository.markReverted(candidateId, id, createdAt);
    if (snapshot) deps.automationPause.restore(candidateId, snapshot);
    throw error;
  }
  return {
    state: readCandidateStatus(deps, candidateId, now),
    applied: { pauseAutoApply: pause },
  };
}

/** «Вернуть прежний»: статус и всё, что кандидат переключил при этой смене. */
export function revertCandidateStatus(
  deps: CandidateStatusDeps,
  candidateId: string,
  now: Date,
): CandidateStatusState {
  const latest = deps.repository.current(candidateId);
  if (!revertOf(latest, now) || !latest) throw new StatusRevertUnavailableError();
  const revertedAt = now.toISOString();
  if (!deps.repository.markReverted(candidateId, latest.id, revertedAt)) {
    throw new StatusRevertUnavailableError();
  }
  if (latest.applied.autoApplyPause) {
    deps.automationPause.restore(candidateId, latest.applied.autoApplyPause);
  }
  deps.changeLog.markReverted(candidateId, latest.id, revertedAt);
  return readCandidateStatus(deps, candidateId, now);
}

export function candidateStatusToday(
  deps: Pick<CandidateStatusDeps, 'repository'>,
  candidateId: string,
  now: Date,
): CandidateStatusToday {
  const latest = deps.repository.current(candidateId);
  const choice = choiceOf(latest);
  return {
    status: choice.status,
    title: titleOf(choice),
    chosen: latest !== null,
    since: latest?.createdAt ?? null,
    modules: todayModulesFor(choice.status),
    revert: revertOf(latest, now),
  };
}
