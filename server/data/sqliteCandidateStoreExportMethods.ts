import { exportPasskeys } from './passkeyExport';
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
import { createTrackerExport, type TrackerExportSources, type TrackerExportStore } from './trackerExport';
import { exportNotifications, type NotificationExportStore } from './notificationExport';
import { exportProfileHistory, type ProfileHistoryExportStore } from './profileHistoryExport';
import { exportContent } from './contentExport';
import { exportCareerSections, exportContacts } from './contactsCareerExport';
import { type AccountExportStore, exportAccount } from './accountExport';
import { exportAutomation } from './automationExport';
import { exportInterviewRecordings } from './interviewRecordingExport';
import { createCareerDiaryExportSources, exportCareerDiary } from './careerDiaryExport';

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
  readonly careerDiaryRepo: Pick<
    import('./sqliteCareerDiaryRepository').SqliteCareerDiaryRepository,
    | 'exportInterviewPractices'
    | 'adaptationApplications'
    | 'listGoals'
    | 'listMeasurements'
    | 'listWeeklyReviewsPage'
    | 'listAchievements'
    | 'listWorkplaces'
  >;
  /** B689/B738: само хранилище, его соединение и ключ — для дневника и трекера. */
  readonly ownStorage: TrackerExportSources & { readonly store: OwnStorageStore };
  readonly diaryEntryRepo: Pick<import('./sqliteDiaryEntryRepository').SqliteDiaryEntryRepository, 'exportAll'>;
  readonly exportConsultantConversations: (
    candidateId: string,
  ) => ConsultantConversationExport[];
  readonly exportExecutiveRequests: (candidateId: string) => StoredExecutiveRequest[];
  /** n02: «Как часто» и «Не показывать название компании». */
  readonly readDeliverySettings: (candidateId: string) => import('./notificationDeliverySettings').DeliverySettings;
  readonly roleSkillAssessments: Pick<RoleSkillAssessmentRepository, 'list'>;
  readonly starStoriesRepo: Pick<SqliteStarStoriesRepository, 'list'>;
  readonly interviewSimulatorRepo: Pick<SqliteInterviewSimulatorRepository, 'getCurrent'>;
}

/** Хранилище глазами выгрузки: методы трекера, уведомлений и истории профиля. */
export type OwnStorageStore = TrackerExportStore & NotificationExportStore & ProfileHistoryExportStore & AccountExportStore;

export function createSqliteCandidateStoreExportMethods(
  dependencies: CandidateExportDependencies,
): CandidateExportMethod {
  const { database, encryptionKey } = dependencies.ownStorage;
  const careerDiary = createCareerDiaryExportSources(database, encryptionKey, dependencies.careerDiaryRepo);
  const exportTracker = createTrackerExport(dependencies.ownStorage);
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
        adaptationApplications: dependencies.careerDiaryRepo.adaptationApplications.exportApplications(candidateId),
        careerDiaryEntries: dependencies.diaryEntryRepo.exportAll(candidateId),
        careerDiary: exportCareerDiary(careerDiary, candidateId),
        notificationDeliverySettings: dependencies.readDeliverySettings(candidateId),
        tracker: exportTracker(candidateId),
        passkeys: exportPasskeys(database, candidateId),
        notifications: exportNotifications(database, dependencies.ownStorage.store, candidateId),
        profileHistory: exportProfileHistory(dependencies.ownStorage, candidateId),
        content: exportContent(dependencies.ownStorage, candidateId),
        contacts: exportContacts(dependencies.ownStorage, candidateId),
        careerSections: exportCareerSections(dependencies.ownStorage, candidateId),
        account: exportAccount(dependencies.ownStorage, candidateId),
        automation: exportAutomation(dependencies.ownStorage, candidateId),
        interviewRecordings: exportInterviewRecordings(dependencies.ownStorage, candidateId),
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
