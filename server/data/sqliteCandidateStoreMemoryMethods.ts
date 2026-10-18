import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { ResumeDraft } from '../domain/resumeDraft';
import type { SealedText } from './sealedText';
import type { ResumeEvidenceSnapshot } from '../domain/resumeStudio';
import type { CandidateSnapshot, StoredMemory } from './candidateStore';
import { CandidateStoreConflictError } from './store/errors';
import { SqliteManualExperienceFactRepository } from './sqliteManualExperienceFactRepository';
import type { ConversationController } from './store/conversationController';

/** What the dossier-review methods need from `SqliteCandidateStore` (kept out of it for the 800-line gate). */
export interface MemoryMethodDeps {
  readonly database: DatabaseSync;
  readonly sealedText: SealedText;
  readonly conversations: ConversationController;
  readonly requireCandidate: (candidateId: string) => unknown;
  readonly transaction: <T>(operation: () => T) => T;
  readonly getSnapshot: (candidateId: string) => CandidateSnapshot;
  readonly saveResumeDraft: (
    candidateId: string,
    draft: ResumeDraft,
    evidence: readonly ResumeEvidenceSnapshot[],
  ) => unknown;
}

function addManualExperienceFact(
  deps: MemoryMethodDeps,
  candidateId: string,
  memoryId: string,
  statement: string,
  experienceId?: string,
): StoredMemory {
  deps.requireCandidate(candidateId);
  return deps.transaction(() => {
    const snapshot = deps.getSnapshot(candidateId);
    const draft = snapshot.resume?.draft;
    if (experienceId && !draft?.experience.some((entry) => entry.id === experienceId)) {
      throw new CandidateStoreConflictError();
    }
    const existingFact = snapshot.memory.some((item) => item.id === memoryId);
    const existingExperienceId = draft?.experience.find((entry) =>
      entry.bulletMemoryIds.includes(memoryId),
    )?.id;
    if (existingFact && existingExperienceId !== experienceId) {
      throw new CandidateStoreConflictError();
    }
    const memory = new SqliteManualExperienceFactRepository(deps.database, deps.sealedText).add(
      candidateId,
      memoryId,
      statement,
    );
    if (experienceId && draft) {
      const experience = draft.experience.map((entry) =>
        entry.id === experienceId && !entry.bulletMemoryIds.includes(memoryId)
          ? { ...entry, bulletMemoryIds: [...entry.bulletMemoryIds, memoryId] }
          : entry,
      );
      deps.saveResumeDraft(
        candidateId,
        { ...draft, experience },
        snapshot.resume?.evidenceSnapshot ?? [],
      );
    }
    return memory;
  });
}

function reviewMemories(
  deps: MemoryMethodDeps,
  candidateId: string,
  memoryIds: readonly string[],
  action: 'confirm' | 'delete',
): number | null {
  deps.requireCandidate(candidateId);
  return deps.transaction(() => {
    const known = new Set(
      deps.conversations.snapshotParts(candidateId).memory.map((item) => item.id),
    );
    // A stale client must not half-review a dossier: either the whole batch
    // is a decision the candidate could actually see, or none of it applies.
    if (memoryIds.some((memoryId) => !known.has(memoryId))) return null;
    // The count is what the candidate is told they decided, so a repeated id
    // must not inflate it.
    const distinct = [...new Set(memoryIds)];
    for (const memoryId of distinct) {
      deps.conversations.changeMemory(candidateId, memoryId, { action });
    }
    return distinct.length;
  });
}

export function createMemoryMethods(deps: MemoryMethodDeps) {
  return {
    addManualExperienceFact: (
      candidateId: string,
      memoryId: string,
      statement: string,
      experienceId?: string,
    ): StoredMemory => addManualExperienceFact(deps, candidateId, memoryId, statement, experienceId),
    reviewMemories: (
      candidateId: string,
      memoryIds: readonly string[],
      action: 'confirm' | 'delete',
    ): number | null => reviewMemories(deps, candidateId, memoryIds, action),
  };
}

export type MemoryMethods = ReturnType<typeof createMemoryMethods>;

/** The store's one SQLite handle: private directory, foreign keys, defensive mode. */
export function openCandidateDatabase(databasePath: string): DatabaseSync {
  if (databasePath !== ':memory:') {
    mkdirSync(dirname(databasePath), { recursive: true, mode: 0o700 });
  }
  return new DatabaseSync(databasePath, {
    timeout: 5_000,
    enableForeignKeyConstraints: true,
    defensive: true,
  });
}
