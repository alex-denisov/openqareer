import { randomUUID } from 'node:crypto';
import type { CandidateStatusId } from '../../shared/candidateStatus';
import type {
  StatusSignalAnswer,
  StatusSignalAnswered,
  StatusSignalKind,
  StatusSignalState,
} from '../../shared/statusSignal';
import { revertDeadline } from '../domain/candidateStatus';
import { detectStatusSignal, type SignalApplication } from '../domain/statusSignals';
import type {
  SqliteStatusSignalRepository,
  StoredSignalAnswer,
} from './sqliteStatusSignalRepository';

/** Откуда сигналы берут факты. Всё читается по id кандидата из сессии. */
export interface StatusSignalSources {
  readonly applications: (candidateId: string) => readonly SignalApplication[];
  readonly roleFamilySkips: (candidateId: string) => readonly string[];
  readonly targetFunctions: (candidateId: string) => readonly string[];
  readonly functionLabels: Readonly<Record<string, string>>;
}

export interface StatusSignalDeps {
  readonly answers: SqliteStatusSignalRepository;
  readonly currentStatus: (candidateId: string) => {
    readonly status: CandidateStatusId;
    readonly since: string | null;
  };
  readonly sources: StatusSignalSources;
}

export class SignalNotActiveError extends Error {
  constructor() {
    super('Этот вопрос уже неактуален.');
  }
}

export class SignalUndoUnavailableError extends Error {
  constructor() {
    super('Отменить ответ можно до конца дня, в который вы ответили.');
  }
}

/**
 * Ответ, который ещё можно отменить: самый новый у кандидата, не отменённый,
 * и день ответа не закончился. После отмены более ранний ответ им не становится.
 */
function undoable(
  deps: StatusSignalDeps,
  candidateId: string,
  answers: readonly StoredSignalAnswer[],
  now: Date,
): StoredSignalAnswer | null {
  const [latest] = answers;
  if (!latest || Date.parse(latest.undoUntil) <= now.getTime()) return null;
  return deps.answers.latestActiveId(candidateId) === latest.id ? latest : null;
}

function answeredOf(answer: StoredSignalAnswer | null): StatusSignalAnswered | null {
  return answer
    ? { id: answer.id, kind: answer.kind, answer: answer.answer, undoUntil: answer.undoUntil }
    : null;
}

export function readStatusSignal(
  deps: StatusSignalDeps,
  candidateId: string,
  now: Date,
  timezone: string,
): StatusSignalState {
  const answers = deps.answers.active(candidateId);
  const current = deps.currentStatus(candidateId);
  const signal = detectStatusSignal({
    now,
    timezone,
    status: current.status,
    statusSince: current.since,
    applications: deps.sources.applications(candidateId),
    roleFamilySkips: deps.sources.roleFamilySkips(candidateId),
    targetFunctions: deps.sources.targetFunctions(candidateId),
    functionLabels: deps.sources.functionLabels,
    answers,
  });
  return { signal, answered: answeredOf(undoable(deps, candidateId, answers, now)) };
}

export interface SignalAnswerInput {
  readonly candidateId: string;
  readonly kind: StatusSignalKind;
  readonly answer: StatusSignalAnswer;
  readonly now: Date;
  readonly timezone: string;
}

/** Записывает ответ на показанный сейчас сигнал. Статус не меняет. */
export function answerStatusSignal(
  deps: StatusSignalDeps,
  input: SignalAnswerInput,
): StatusSignalState {
  const shown = readStatusSignal(deps, input.candidateId, input.now, input.timezone).signal;
  if (shown?.kind !== input.kind) throw new SignalNotActiveError();
  deps.answers.record({
    id: randomUUID(),
    candidateId: input.candidateId,
    kind: input.kind,
    answer: input.answer,
    createdAt: input.now.toISOString(),
    undoUntil: revertDeadline(input.now, input.timezone),
  });
  return readStatusSignal(deps, input.candidateId, input.now, input.timezone);
}

/** «Отменить ответ»: до конца дня кандидата, только последний ответ. */
export function undoStatusSignalAnswer(
  deps: StatusSignalDeps,
  candidateId: string,
  now: Date,
  timezone: string,
): StatusSignalState {
  const latest = undoable(deps, candidateId, deps.answers.active(candidateId), now);
  if (!latest || !deps.answers.markUndone(candidateId, latest.id, now.toISOString())) {
    throw new SignalUndoUnavailableError();
  }
  return readStatusSignal(deps, candidateId, now, timezone);
}
