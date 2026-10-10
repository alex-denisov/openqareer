import type {
  CandidateExport,
  CandidateSnapshot,
  CandidateStore,
  ConsultantConversationExport,
  StoredExecutiveRequest,
} from './candidateStore';
import type { SqliteCareerStrategyRepository } from './sqliteCareerStrategyRepository';
import type { SqliteDocumentRepository } from './sqliteDocumentRepository';
import type { SqliteWorkPreferenceRepository } from './sqliteWorkPreferenceRepository';
import type { SourceConnectionController } from './store/sourceConnectionController';

type CandidateExportMethod = Required<Pick<CandidateStore, 'exportCandidate'>>;

interface CandidateExportDependencies {
  readonly getSnapshot: (candidateId: string) => CandidateSnapshot;
  readonly sourceConnections: Pick<SourceConnectionController, 'list'>;
  readonly careerStrategyRepository: Pick<SqliteCareerStrategyRepository, 'get'>;
  readonly workPreferenceRepository: Pick<SqliteWorkPreferenceRepository, 'get'>;
  readonly documentRepository: Pick<SqliteDocumentRepository, 'get'>;
  readonly exportConsultantConversations: (
    candidateId: string,
  ) => ConsultantConversationExport[];
  readonly exportExecutiveRequests: (candidateId: string) => StoredExecutiveRequest[];
}

export function createSqliteCandidateStoreExportMethods(
  dependencies: CandidateExportDependencies,
): CandidateExportMethod {
  return {
    exportCandidate(candidateId): CandidateExport {
      const snapshot = dependencies.getSnapshot(candidateId);
      return {
        ...snapshot,
        executiveRequests: dependencies.exportExecutiveRequests(candidateId),
        sourceConnections: dependencies.sourceConnections.list(candidateId).map((connection) => ({
          id: connection.id,
          platform: connection.platform,
          accessMode: connection.accessMode,
          connectedAt: connection.connectedAt,
          lastImportedAt: connection.lastImportedAt,
          capturedAt: connection.receipt.capturedAt,
          factCount: connection.receipt.factCount,
        })),
        careerStrategy: dependencies.careerStrategyRepository.get(candidateId),
        workPreferences: dependencies.workPreferenceRepository.get(candidateId),
        consultantConversations: dependencies.exportConsultantConversations(candidateId),
        documentContents: snapshot.documents.flatMap((document) => {
          const stored = dependencies.documentRepository.get(candidateId, document.id);
          return stored ? [stored] : [];
        }),
      };
    },
  };
}
