import type {
  LinkedInLanguageImportSnapshot,
  StoredNativeSourceConnection,
  StoredResumeDraft,
} from './candidateStore';

export function linkedInLanguageImportFromStoredProfile(
  connections: readonly StoredNativeSourceConnection[],
  resume: StoredResumeDraft | null,
): LinkedInLanguageImportSnapshot | null {
  const source = connections.find((connection) => connection.platform === 'linkedin');
  if (!source || !resume) return null;
  const importedIds = new Set(source.receipt.memoryIds);
  const languages = resume.draft.languages.filter(
    (language) => importedIds.has(language.evidenceMemoryId) && Boolean(language.name?.trim()),
  );
  return languages.length > 0
    ? { capturedAt: source.receipt.capturedAt, importedAt: source.lastImportedAt, languages }
    : null;
}

export function createSqliteCandidateStoreLinkedInMethods(dependencies: {
  readonly requireCandidate: (candidateId: string) => unknown;
  readonly listConnections: (candidateId: string) => readonly StoredNativeSourceConnection[];
  readonly readResume: (candidateId: string) => StoredResumeDraft | null;
}) {
  return {
    getLinkedInLanguageImport(candidateId: string): LinkedInLanguageImportSnapshot | null {
      dependencies.requireCandidate(candidateId);
      return linkedInLanguageImportFromStoredProfile(
        dependencies.listConnections(candidateId),
        dependencies.readResume(candidateId),
      );
    },
  };
}
