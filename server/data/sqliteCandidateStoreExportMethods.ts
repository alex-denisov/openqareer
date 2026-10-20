import type {
  CandidateExport,
  CandidateSnapshot,
  CandidateStore,
  ConsultantConversationExport,
  StoredExecutiveRequest,
} from './candidateStore';
import type { SqliteCareerStrategyRepository } from './sqliteCareerStrategyRepository';
import type { SqliteDocumentRepository } from './sqliteDocumentRepository';
import type { SqliteRelocationQuestionnaireRepository } from './sqliteRelocationQuestionnaireRepository';
import type { SqliteWorkPreferenceRepository } from './sqliteWorkPreferenceRepository';
import type { SourceConnectionController } from './store/sourceConnectionController';
import type { SqliteInterviewSimulatorRepository } from './sqliteInterviewSimulatorRepository';
import type { SqliteStarStoriesRepository } from './sqliteStarStoriesRepository';
import type { RoleSkillAssessmentRepository } from './sqliteRoleSkillAssessmentRepository';
import { toExportedSourceConnection } from './store/exportedSourceConnection';

type CandidateExportMethod = Required<Pick<CandidateStore, 'exportCandidate'>>;

interface CandidateExportDependencies {
  readonly getSnapshot: (candidateId: string) => CandidateSnapshot;
  readonly sourceConnections: Pick<SourceConnectionController, 'list'>;
  readonly careerStrategyRepository: Pick<SqliteCareerStrategyRepository, 'get'>;
  readonly workPreferenceRepository: Pick<SqliteWorkPreferenceRepository, 'get'>;
  readonly documentRepository: Pick<SqliteDocumentRepository, 'get'>;
  readonly relocationQuestionnaireRepo: Pick<
    SqliteRelocationQuestionnaireRepository,
    'getProfile' | 'getConsent' | 'scenarios'
  >;
  readonly careerDiaryRepo: Pick<import('./sqliteCareerDiaryRepository').SqliteCareerDiaryRepository, 'exportInterviewPractices'>;
  readonly exportConsultantConversations: (
    candidateId: string,
  ) => ConsultantConversationExport[];
  readonly exportExecutiveRequests: (candidateId: string) => StoredExecutiveRequest[];
  readonly roleSkillAssessments: Pick<RoleSkillAssessmentRepository, 'list'>;
  readonly starStoriesRepo: Pick<SqliteStarStoriesRepository, 'list'>;
  readonly interviewSimulatorRepo: Pick<SqliteInterviewSimulatorRepository, 'getCurrent'>;
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
        sourceConnections: dependencies.sourceConnections.list(candidateId).map(toExportedSourceConnection),
        careerStrategy: dependencies.careerStrategyRepository.get(candidateId),
        workPreferences: dependencies.workPreferenceRepository.get(candidateId),
        relocationQuestionnaire: dependencies.relocationQuestionnaireRepo.getProfile(candidateId),
        relocationConsent: dependencies.relocationQuestionnaireRepo.getConsent(candidateId),
        roleSkillAssessments: dependencies.roleSkillAssessments.list(candidateId),
        starStories: dependencies.starStoriesRepo.list(candidateId),
        interviewSession: dependencies.interviewSimulatorRepo.getCurrent(candidateId),
        interviewPractices: dependencies.careerDiaryRepo.exportInterviewPractices(candidateId),
        relocationScenarios: dependencies.relocationQuestionnaireRepo.scenarios.list(candidateId, 50).items,
        consultantConversations: dependencies.exportConsultantConversations(candidateId),
        documentContents: snapshot.documents.flatMap((document) => {
          const stored = dependencies.documentRepository.get(candidateId, document.id);
          return stored ? [stored] : [];
        }),
      };
    },
  };
}
