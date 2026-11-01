import { randomUUID } from 'node:crypto';
import type { CandidateStore } from '../data/candidateStore';
import type {
  FactTrustState,
  ProfileChangeActor,
  ProfileChangeEntry,
} from '../data/sqliteProfileChangeLogRepository';
import {
  currentProfileValue,
  describeProfileValue,
  withProfileValue,
} from '../domain/profileChangeDiff';
import { EMPTY_RESUME_DRAFT } from '../domain/resumeDraft';
import { buildResumeStudioProjection } from '../domain/resumeStudio';
import { experienceFactIds } from './careerCommandDispatcher';

export const PROFILE_HISTORY_PAGE_SIZE = 20;
const CANDIDATE_CONFIRMED = 'candidate-confirmed';

export class ProfileChangeNotFoundError extends Error {
  constructor() {
    super('Изменение не найдено.');
  }
}

export class ProfileChangeAlreadyRevertedError extends Error {
  constructor() {
    super('Это изменение уже возвращено.');
  }
}

/** The value changed after this entry, so returning it would overwrite a newer edit. */
export class ProfileChangeConflictError extends Error {
  constructor() {
    super('С тех пор это место изменилось. Вернуть прежнее значение нельзя.');
  }
}

export interface ProfileHistoryItem {
  readonly id: string;
  readonly actor: ProfileChangeActor;
  readonly section: string;
  readonly kind: ProfileChangeEntry['kind'];
  readonly itemId: string | null;
  readonly label: string;
  readonly previousText: string;
  readonly appliedText: string;
  readonly createdAt: string;
  readonly revertedAt: string | null;
}

export interface ProfileHistoryPage {
  readonly entries: readonly ProfileHistoryItem[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
}

export function listProfileHistory(
  store: CandidateStore,
  candidateId: string,
  page: number,
): ProfileHistoryPage {
  const { entries, total } = store.profileChangeLog.list(
    candidateId,
    page,
    PROFILE_HISTORY_PAGE_SIZE,
  );
  return {
    entries: entries.map((entry) => ({
      id: entry.id,
      actor: entry.actor,
      section: entry.section,
      kind: entry.kind,
      itemId: entry.itemId,
      label: entry.label,
      previousText: describeProfileValue(entry.previous),
      appliedText: describeProfileValue(entry.applied),
      createdAt: entry.createdAt,
      revertedAt: entry.revertedAt,
    })),
    total,
    page,
    pageSize: PROFILE_HISTORY_PAGE_SIZE,
  };
}

/**
 * The explicit «Подтвердить» on a workplace: every fact of the entry becomes
 * candidate-confirmed. Returns false when the entry does not exist.
 */
export function confirmExperience(
  store: CandidateStore,
  candidateId: string,
  experienceId: string,
): boolean {
  return store.transaction(() => {
    const draft = store.getSnapshot(candidateId).resume?.draft;
    const entry = draft?.experience.find((item) => item.id === experienceId);
    if (!entry) return false;
    const states = store.profileChangeLog.readFactStates(candidateId, experienceFactIds(entry));
    const changed = states.filter(
      (state) => state.status !== 'confirmed' || state.confidence !== CANDIDATE_CONFIRMED,
    );
    if (changed.length === 0) return true;
    const createdAt = new Date().toISOString();
    store.profileChangeLog.writeFactStates(candidateId, changed.map(confirmed), createdAt);
    store.profileChangeLog.record({
      id: randomUUID(),
      candidateId,
      actor: 'candidate',
      section: 'experience',
      kind: 'confirmation',
      itemId: experienceId,
      label: [entry.title, entry.employer].filter(Boolean).join(' · '),
      previous: 'Не подтверждено вами',
      applied: 'Подтверждено вами',
      commandId: null,
      factStates: changed,
      createdAt,
    });
    return true;
  });
}

/**
 * «Вернуть» from the history. A consultant entry goes through the command's
 * own revert; the rest compare the current value with the logged one first.
 */
export async function revertProfileChange(
  store: CandidateStore,
  candidateId: string,
  changeId: string,
  revertCommand: (commandId: string) => Promise<unknown>,
): Promise<void> {
  const entry = store.profileChangeLog.get(candidateId, changeId);
  if (!entry) throw new ProfileChangeNotFoundError();
  if (entry.revertedAt) throw new ProfileChangeAlreadyRevertedError();
  if (entry.commandId) {
    await revertCommand(entry.commandId);
    return;
  }
  store.transaction(() => {
    const revertedAt = new Date().toISOString();
    if (entry.kind === 'confirmation') {
      revertConfirmation(store, candidateId, entry, revertedAt);
    } else {
      revertValue(store, candidateId, entry);
    }
    store.profileChangeLog.markReverted(candidateId, entry.id, revertedAt);
  });
}

function revertConfirmation(
  store: CandidateStore,
  candidateId: string,
  entry: ProfileChangeEntry,
  revertedAt: string,
): void {
  const ids = entry.factStates.map((state) => state.memoryId);
  const current = store.profileChangeLog.readFactStates(candidateId, ids);
  const untouched =
    current.length === ids.length &&
    current.every(
      (state) => state.status === 'confirmed' && state.confidence === CANDIDATE_CONFIRMED,
    );
  if (!untouched) throw new ProfileChangeConflictError();
  store.profileChangeLog.writeFactStates(candidateId, entry.factStates, revertedAt);
}

function revertValue(store: CandidateStore, candidateId: string, entry: ProfileChangeEntry): void {
  const snapshot = store.getSnapshot(candidateId);
  const draft = snapshot.resume?.draft ?? EMPTY_RESUME_DRAFT;
  if (currentProfileValue(draft, entry.section, entry.itemId) !== entry.applied) {
    throw new ProfileChangeConflictError();
  }
  const reverted = withProfileValue(draft, entry.section, entry.itemId, entry.previous);
  const projection = buildResumeStudioProjection({ ...reverted, evidence: snapshot.memory });
  store.saveResumeDraft(candidateId, reverted, projection.evidenceSnapshot);
}

function confirmed(state: FactTrustState): FactTrustState {
  return { ...state, status: 'confirmed', confidence: CANDIDATE_CONFIRMED };
}
