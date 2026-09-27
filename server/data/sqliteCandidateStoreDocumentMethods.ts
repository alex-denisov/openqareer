import type {
  CandidateDocumentInput,
  CandidateDocumentWithContent,
  CandidateStore,
  StoredCandidateDocument,
  StoredMemory,
} from './candidateStore';
import type { DatabaseSync } from 'node:sqlite';
import type { ApplicationMaterialRole, StoredApplicationMaterial } from './sqliteApplicationMaterialsRepository';
import type { SqliteDocumentRepository } from './sqliteDocumentRepository';
import { CandidateDocumentRetentionError, CandidateStoreConflictError } from './store/errors';

type Transaction = <T>(operation: () => T) => T;
type RequireCandidate = (candidateId: string) => void;
type LinkMaterial = (
  candidateId: string,
  applicationId: string,
  role: ApplicationMaterialRole,
  documentId: string,
) => StoredApplicationMaterial;
export type SqliteCandidateStoreDocumentMethods = Pick<
  CandidateStore,
  | 'saveDocument'
  | 'saveDocumentAndLinkApplicationMaterial'
  | 'getDocument'
  | 'deleteDocument'
  | 'setDocumentRetention'
  | 'purgeExpiredDocuments'
>;

interface DocumentMethodsDependencies {
  readonly database: DatabaseSync;
  readonly documents: SqliteDocumentRepository;
  readonly requireCandidate: RequireCandidate;
  readonly transaction: Transaction;
  readonly linkMaterial: LinkMaterial;
}

export function createSqliteCandidateStoreDocumentMethods(
  input: DocumentMethodsDependencies,
): SqliteCandidateStoreDocumentMethods {
  return {
    saveDocument: (candidateId, documentInput) => saveDocument(input, candidateId, documentInput),
    saveDocumentAndLinkApplicationMaterial: (candidateId, applicationId, role, documentInput) =>
      saveDocumentAndLink(input, candidateId, applicationId, role, documentInput),
    getDocument: (candidateId, documentId) => getDocument(input, candidateId, documentId),
    deleteDocument: (candidateId, documentId) => deleteDocument(input, candidateId, documentId),
    setDocumentRetention: (candidateId, documentId, retentionUntil, now) =>
      setDocumentRetention(input, candidateId, documentId, retentionUntil, now),
    purgeExpiredDocuments: (now, limit) => purgeExpiredDocuments(input, now, limit),
  };
}

function saveDocument(
  input: DocumentMethodsDependencies,
  candidateId: string,
  documentInput: CandidateDocumentInput,
): ReturnType<CandidateStore['saveDocument']> {
  input.requireCandidate(candidateId);
  return input.documents.save(candidateId, documentInput);
}

function saveDocumentAndLink(
  input: DocumentMethodsDependencies,
  candidateId: string,
  applicationId: string,
  role: ApplicationMaterialRole,
  documentInput: CandidateDocumentInput,
): ReturnType<CandidateStore['saveDocumentAndLinkApplicationMaterial']> {
  input.requireCandidate(candidateId);
  return input.transaction(() => {
    const saved = input.documents.save(candidateId, documentInput);
    const material = input.linkMaterial(candidateId, applicationId, role, saved.document.id);
    return { ...saved, material };
  });
}

function getDocument(
  input: DocumentMethodsDependencies,
  candidateId: string,
  documentId: string,
): CandidateDocumentWithContent | null {
  input.requireCandidate(candidateId);
  return input.documents.get(candidateId, documentId);
}

function deleteDocument(
  input: DocumentMethodsDependencies,
  candidateId: string,
  documentId: string,
): boolean {
  input.requireCandidate(candidateId);
  return input.transaction(() => {
    const deleted = input.documents.delete(candidateId, documentId);
    if (deleted) invalidateDocumentKnowledge(input.database, candidateId, documentId);
    return deleted;
  });
}

function setDocumentRetention(
  input: DocumentMethodsDependencies,
  candidateId: string,
  documentId: string,
  retentionUntil: string | null,
  now: string,
): StoredCandidateDocument | null {
  input.requireCandidate(candidateId);
  return input.documents.setRetention(candidateId, documentId, normalizeRetentionUntil(retentionUntil, now));
}

function purgeExpiredDocuments(
  input: DocumentMethodsDependencies,
  now: string,
  limit: number,
): number {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new CandidateStoreConflictError();
  const expired = input.documents.listExpired(now, limit);
  return input.transaction(() => {
    let purged = 0;
    for (const document of expired) {
      if (input.documents.delete(document.candidateId, document.documentId, now)) {
        invalidateDocumentKnowledge(input.database, document.candidateId, document.documentId, now);
        purged += 1;
      }
    }
    return purged;
  });
}

function invalidateDocumentKnowledge(
  database: DatabaseSync,
  candidateId: string,
  documentId: string,
  invalidatedAt = new Date().toISOString(),
): void {
  const sourceRef = `document:${documentId}`;
  const deletedSourceRef = `deleted-document:${documentId}`;
  const rows = database
    .prepare(
      `SELECT id, status, source_message_ids
       FROM memory
       WHERE candidate_id = ? AND status != 'deleted'`,
    )
    .all(candidateId) as Array<{
    id: string;
    status: StoredMemory['status'];
    source_message_ids: string;
  }>;
  for (const row of rows) {
    const sourceRefs = JSON.parse(row.source_message_ids) as string[];
    if (!sourceRefs.includes(sourceRef)) continue;
    const remainingRefs = sourceRefs.filter((ref) => ref !== sourceRef);
    database
      .prepare(
        `UPDATE memory
         SET source_message_ids = ?, status = ?, updated_at = ?
         WHERE candidate_id = ? AND id = ?`,
      )
      .run(
        JSON.stringify(remainingRefs.length > 0 ? remainingRefs : [deletedSourceRef]),
        remainingRefs.length > 0 ? row.status : 'proposed',
        invalidatedAt,
        candidateId,
        row.id,
      );
  }
}

function normalizeRetentionUntil(retentionUntil: string | null, now: string): string | null {
  if (retentionUntil === null) return null;
  const nowTime = Date.parse(now);
  const retentionTime = Date.parse(retentionUntil);
  const maxRetentionTime = nowTime + 10 * 366 * 24 * 60 * 60 * 1_000;
  if (
    !Number.isFinite(nowTime) ||
    !Number.isFinite(retentionTime) ||
    retentionTime <= nowTime ||
    retentionTime > maxRetentionTime
  ) {
    throw new CandidateDocumentRetentionError();
  }
  return new Date(retentionTime).toISOString();
}
