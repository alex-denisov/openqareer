import type { CoachTurnInput } from '../../domain/coach';
import { isImportedMemoryId } from '../../domain/resumeImport';
import type { StoredMemory } from '../candidateStore';
import type { SqliteDocumentRepository } from '../sqliteDocumentRepository';

/** Imported profiles run to ~50 facts; 40 keeps the block under ~1.5K tokens. */
export const KNOWN_FACTS_LIMIT = 40;

export function buildDocumentKnowledgeContext(
  candidateId: string,
  documentRepository: SqliteDocumentRepository,
): NonNullable<CoachTurnInput['knowledgeContext']>['documents'] {
  return documentRepository
    .list(candidateId)
    .filter(
      (document) =>
        document.parseStatus === 'ready' &&
        (document.kind === 'resume' || document.kind === 'profile_export'),
    )
    .flatMap((document) => {
      const stored = documentRepository.get(candidateId, document.id);
      const excerpt = stored?.extractedText?.trim();
      return excerpt
        ? [
            {
              ref: `document:${document.id}`,
              kind: document.kind,
              fileName: document.fileName,
              version: document.version,
              sha256: document.sha256,
              excerpt: excerpt.slice(0, 6_000),
            },
          ]
        : [];
    })
    .slice(0, 2);
}

export function buildKnowledgeContext(
  memory: StoredMemory[],
  candidateId: string,
  documentRepository: SqliteDocumentRepository,
): NonNullable<CoachTurnInput['knowledgeContext']> {
  const isConfirmed = (item: StoredMemory) =>
    item.status === 'confirmed' || item.status === 'corrected';
  const isImported = (item: StoredMemory) =>
    item.status === 'proposed' &&
    item.kind !== 'open-question' &&
    isImportedMemoryId(item.id);
  const known = [
    ...memory.filter(isConfirmed).slice(-12),
    ...memory.filter(isImported),
  ].slice(0, KNOWN_FACTS_LIMIT);
  const confirmedFacts = known.map((item) => ({
    ref: `memory:${item.id}`,
    kind: item.kind,
    domain: item.domain,
    statement: item.statement.slice(0, 1_000),
    sourceRefs: item.sourceMessageIds.slice(0, 20),
    sensitive: item.sensitive,
    source: isConfirmed(item) ? ('confirmed' as const) : ('imported' as const),
  }));
  const openQuestions = memory
    .filter((item) => item.kind === 'open-question' && item.status === 'proposed')
    .slice(-12)
    .map((item) => ({
      ref: `memory:${item.id}`,
      statement: item.statement,
      sourceRefs: item.sourceMessageIds,
    }));
  return {
    confirmedFacts,
    openQuestions,
    documents: buildDocumentKnowledgeContext(candidateId, documentRepository),
  };
}
