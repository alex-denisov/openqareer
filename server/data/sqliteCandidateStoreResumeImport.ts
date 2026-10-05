import type { DatabaseSync } from 'node:sqlite';
import { buildResumeStudioProjection } from '../domain/resumeStudio';
import type {
  CommittedResumeImport,
  ImportedResumeEvidence,
  ResumeEvidenceImport,
  ResumeImportCommit,
  StoredMemory,
} from './candidateStore';
import { remapResumeImportDraftEvidence, resumeImportConflictKey, resumeImportFactKey } from '../domain/resumeImport';
import { CandidateStoreConflictError } from './store/errors';
import type { ConversationController } from './store/conversationController';
import type { SourceConnectionController } from './store/sourceConnectionController';
import type { SqliteCandidateMediaRepository } from './sqliteCandidateMediaRepository';
import type { SqliteResumeRepository } from './sqliteResumeRepository';

const MAX_MEMORY_SOURCE_MESSAGES = 20;

interface ResumeImportDependencies {
  readonly database: DatabaseSync;
  readonly conversations: ConversationController;
  readonly sourceConnections: SourceConnectionController;
  readonly resumeRepository: SqliteResumeRepository;
  readonly candidateMediaRepository: SqliteCandidateMediaRepository;
}

interface PreparedResumeImport {
  readonly evidence: ResumeEvidenceImport;
  readonly memoryIdMap: ReadonlyMap<string, string>;
  readonly reusedMemoryIds: readonly string[];
  readonly conflictingMemoryIds: ReadonlySet<string>;
}

interface PreparedResumeEntries {
  readonly entries: ResumeEvidenceImport['entries'];
  readonly memoryIdMap: ReadonlyMap<string, string>;
  readonly reusedMemoryIds: readonly string[];
  readonly conflictingMemoryIds: ReadonlySet<string>;
}

export function commitNewResumeImport(
  dependencies: ResumeImportDependencies,
  candidateId: string,
  input: ResumeImportCommit,
): CommittedResumeImport {
  const replaced = input.sourceReceipt
    ? dependencies.sourceConnections
        .list(candidateId)
        .find((connection) => connection.platform === input.sourceReceipt?.platform)
    : undefined;
  const prepared = prepareResumeImport(
    dependencies,
    candidateId,
    input.evidence,
    Boolean(input.sourceReceipt),
    replaced?.receipt.sourceMessageId,
  );
  const evidence = writeResumeImportEvidence(
    dependencies,
    candidateId,
    input.evidence,
    prepared,
    replaced?.receipt.sourceMessageId,
  );
  removeReplacedResumeFacts(dependencies, candidateId, input, replaced, prepared, evidence);
  const resume = saveResumeImportDraft(dependencies, candidateId, input, prepared);
  const sourceConnection = input.sourceReceipt
    ? dependencies.sourceConnections.upsert(candidateId, input.sourceReceipt, evidence)
    : undefined;
  return { evidence, resume, sourceConnection, idempotentReplay: false };
}

function writeResumeImportEvidence(
  dependencies: ResumeImportDependencies,
  candidateId: string,
  input: ResumeEvidenceImport,
  prepared: PreparedResumeImport,
  replacedSourceMessageId?: string,
): ImportedResumeEvidence {
  const written = dependencies.conversations.importResumeEvidenceInTransaction(
    candidateId,
    prepared.evidence,
  );
  mergeResumeImportProvenance(
    dependencies.database,
    candidateId,
    written.messageId,
    prepared.reusedMemoryIds,
    replacedSourceMessageId,
  );
  return committedEvidence(input, written, prepared.memoryIdMap);
}

function removeReplacedResumeFacts(
  dependencies: ResumeImportDependencies,
  candidateId: string,
  input: ResumeImportCommit,
  replaced: ReturnType<SourceConnectionController['list']>[number] | undefined,
  prepared: PreparedResumeImport,
  evidence: ImportedResumeEvidence,
): void {
  if (replaced) {
    dependencies.conversations.purgeReplacedImportedFacts(
      candidateId,
      replaced.receipt.sourceMessageId,
      replaced.receipt.memoryIds.filter(
        (memoryId) => !prepared.conflictingMemoryIds.has(memoryId),
      ),
    );
    return;
  }
  if (input.sourceReceipt) return;
  dependencies.conversations.purgeSupersededFileImportFacts(
    candidateId,
    evidence.messageId,
    dependencies.sourceConnections
      .list(candidateId)
      .map((connection) => connection.receipt.sourceMessageId),
  );
}

function saveResumeImportDraft(
  dependencies: ResumeImportDependencies,
  candidateId: string,
  input: ResumeImportCommit,
  prepared: PreparedResumeImport,
) {
  const draft = remapResumeImportDraftEvidence(input.draft, prepared.memoryIdMap);
  const projection = buildResumeStudioProjection({
    ...draft,
    evidence: dependencies.conversations.snapshotParts(candidateId).memory,
  });
  if (input.media?.length) {
    dependencies.candidateMediaRepository.saveMany(candidateId, input.media);
  }
  const resume = dependencies.resumeRepository.save(
    candidateId,
    draft,
    projection.evidenceSnapshot,
    input.reader,
  );
  dependencies.candidateMediaRepository.pruneUnreferenced(
    candidateId,
    referencedMediaIds(draft),
  );
  return resume;
}

function prepareResumeImport(
  dependencies: ResumeImportDependencies,
  candidateId: string,
  evidence: ResumeEvidenceImport,
  preserveConflicts: boolean,
  replacedSourceMessageId?: string,
): PreparedResumeImport {
  const { existingByFact, existingByConflict } = indexExistingFacts(
    dependencies,
    candidateId,
  );
  const sourceMessageId = evidence.sourceDigest
    ? `resume-import:${evidence.sourceDigest}`
    : undefined;
  const mapped = mapResumeImportEntries(
    evidence.entries,
    sourceMessageId,
    replacedSourceMessageId,
    preserveConflicts,
    existingByFact,
    existingByConflict,
  );
  return { evidence: { ...evidence, entries: mapped.entries }, ...mapped };
}

function mapResumeImportEntries(
  entries: ResumeEvidenceImport['entries'],
  sourceMessageId: string | undefined,
  replacedSourceMessageId: string | undefined,
  preserveConflicts: boolean,
  existingByFact: ReadonlyMap<string, StoredMemory>,
  existingByConflict: ReadonlyMap<string, readonly StoredMemory[]>,
): PreparedResumeEntries {
  const importedByFact = new Map<string, string>();
  const memoryIdMap = new Map<string, string>();
  const reusedMemoryIds = new Set<string>();
  const conflictingMemoryIds = new Set<string>();
  const keptEntries: ResumeEvidenceImport['entries'][number][] = [];
  for (const entry of entries) {
    const factKey = resumeImportFactKey(entry.domain, entry.statement);
    const previousImport = importedByFact.get(factKey);
    if (previousImport) {
      memoryIdMap.set(entry.memoryId, previousImport);
      continue;
    }
    const existing = existingByFact.get(factKey);
    if (
      existing &&
      canMergeImportedFact(existing, sourceMessageId, replacedSourceMessageId)
    ) {
      importedByFact.set(factKey, existing.id);
      memoryIdMap.set(entry.memoryId, existing.id);
      reusedMemoryIds.add(existing.id);
      continue;
    }
    markConflictingMemories(
      entry,
      factKey,
      existingByConflict,
      preserveConflicts,
      conflictingMemoryIds,
    );
    importedByFact.set(factKey, entry.memoryId);
    memoryIdMap.set(entry.memoryId, entry.memoryId);
    keptEntries.push(entry);
  }
  return {
    entries: keptEntries,
    memoryIdMap,
    reusedMemoryIds: [...reusedMemoryIds],
    conflictingMemoryIds,
  };
}

function indexExistingFacts(
  dependencies: ResumeImportDependencies,
  candidateId: string,
): {
  readonly existingByFact: Map<string, StoredMemory>;
  readonly existingByConflict: Map<string, StoredMemory[]>;
} {
  const existingByFact = new Map<string, StoredMemory>();
  const existingByConflict = new Map<string, StoredMemory[]>();
  for (const memory of dependencies.conversations.snapshotParts(candidateId).memory) {
    if (memory.kind !== 'fact') continue;
    const key = resumeImportFactKey(memory.domain, memory.statement);
    const existing = existingByFact.get(key);
    if (!existing || (existing.status === 'proposed' && memory.status !== 'proposed')) {
      existingByFact.set(key, memory);
    }
    const conflictKey = resumeImportConflictKey(memory.id, memory.domain, memory.statement);
    if (conflictKey) {
      existingByConflict.set(conflictKey, [
        ...(existingByConflict.get(conflictKey) ?? []),
        memory,
      ]);
    }
  }
  return { existingByFact, existingByConflict };
}

function markConflictingMemories(
  entry: ResumeEvidenceImport['entries'][number],
  factKey: string,
  existingByConflict: ReadonlyMap<string, readonly StoredMemory[]>,
  preserveConflicts: boolean,
  conflictingMemoryIds: Set<string>,
): void {
  if (!preserveConflicts) return;
  const conflictKey = resumeImportConflictKey(entry.memoryId, entry.domain, entry.statement);
  if (!conflictKey) return;
  for (const conflicting of existingByConflict.get(conflictKey) ?? []) {
    if (resumeImportFactKey(conflicting.domain, conflicting.statement) !== factKey) {
      conflictingMemoryIds.add(conflicting.id);
    }
  }
}

function committedEvidence(
  input: ResumeEvidenceImport,
  written: ImportedResumeEvidence,
  memoryIdMap: ReadonlyMap<string, string>,
): ImportedResumeEvidence {
  return {
    messageId: written.messageId,
    memoryIds: [
      ...new Set(
        input.entries.map((entry) => memoryIdMap.get(entry.memoryId) ?? entry.memoryId),
      ),
    ],
  };
}

function mergeResumeImportProvenance(
  database: DatabaseSync,
  candidateId: string,
  sourceMessageId: string,
  memoryIds: readonly string[],
  replacedSourceMessageId?: string,
): void {
  const select = database.prepare(
    `SELECT source_message_ids FROM memory
     WHERE id = ? AND candidate_id = ? AND status != 'deleted'`,
  );
  const update = database.prepare(
    `UPDATE memory SET source_message_ids = ?, updated_at = ?
     WHERE id = ? AND candidate_id = ? AND status != 'deleted'`,
  );
  const now = new Date().toISOString();
  for (const memoryId of memoryIds) {
    const row = select.get(memoryId, candidateId) as
      | { source_message_ids: string }
      | undefined;
    if (!row) throw new CandidateStoreConflictError();
    const sourceMessageIds = JSON.parse(row.source_message_ids) as string[];
    const retainedMessageIds = replacedSourceMessageId
      ? sourceMessageIds.filter((id) => id !== replacedSourceMessageId)
      : sourceMessageIds;
    if (retainedMessageIds.includes(sourceMessageId)) continue;
    if (retainedMessageIds.length >= MAX_MEMORY_SOURCE_MESSAGES) {
      throw new CandidateStoreConflictError();
    }
    update.run(
      JSON.stringify([...retainedMessageIds, sourceMessageId]),
      now,
      memoryId,
      candidateId,
    );
  }
}

function canMergeImportedFact(
  memory: StoredMemory,
  sourceMessageId?: string,
  replacedSourceMessageId?: string,
): boolean {
  if (
    sourceMessageId &&
    memory.status === 'proposed' &&
    memory.sourceMessageIds.length === 1 &&
    memory.sourceMessageIds[0] === sourceMessageId
  ) {
    return false;
  }
  const retainedMessageIds = replacedSourceMessageId
    ? memory.sourceMessageIds.filter((id) => id !== replacedSourceMessageId)
    : memory.sourceMessageIds;
  return (
    (sourceMessageId !== undefined && retainedMessageIds.includes(sourceMessageId)) ||
    retainedMessageIds.length < MAX_MEMORY_SOURCE_MESSAGES
  );
}

function referencedMediaIds(draft: ResumeImportCommit['draft']): string[] {
  return [
    draft.candidate.photoMediaId,
    ...draft.experience.map((role) => role.employerLogoMediaId),
  ].filter((value): value is string => Boolean(value));
}
