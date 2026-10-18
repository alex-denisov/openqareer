import type { DatabaseSync } from 'node:sqlite';
import { ApplicationTrackerController } from './store/applicationTrackerController';
import { SqliteAssessmentRepository } from './sqliteAssessmentRepository';
import { SqliteCareerCommandRepository } from './sqliteCareerCommandRepository';
import { SqliteCandidateMediaRepository } from './sqliteCandidateMediaRepository';
import { SqliteDocumentRepository } from './sqliteDocumentRepository';
import { SqliteMarketRepository } from './sqliteMarketRepository';
import { SqliteResumeRepository } from './sqliteResumeRepository';
import { SqliteResumeVersionRepository } from './sqliteResumeVersionRepository';
import { SqliteVacancyApplicationRepository } from './sqliteVacancyApplicationRepository';
import { SqliteVacancyRepository } from './sqliteVacancyRepository';
import { SqliteWorkPreferenceRepository } from './sqliteWorkPreferenceRepository';
import { SqliteWorkspaceRepository } from './sqliteWorkspaceRepository';
import { SqliteCareerStrategyRepository } from './sqliteCareerStrategyRepository';
import type { SealedText } from './sealedText';

export function createSqliteCandidateStoreRepositories(
  database: DatabaseSync,
  sealedText: SealedText,
  transaction: <T>(operation: () => T) => T,
) {
  const legacyApplications = new SqliteVacancyApplicationRepository(database, sealedText);
  const workspaceRepository = new SqliteWorkspaceRepository(database, sealedText);
  const documentRepository = new SqliteDocumentRepository(database, sealedText);
  return {
    applicationTracker: new ApplicationTrackerController(
      database,
      sealedText,
      legacyApplications,
      workspaceRepository,
      documentRepository,
      transaction,
    ),
    assessmentsRepository: new SqliteAssessmentRepository(database, sealedText),
    marketRepository: new SqliteMarketRepository(database, sealedText),
    resumeRepository: new SqliteResumeRepository(database, sealedText),
    resumeVersionRepository: new SqliteResumeVersionRepository(database, sealedText),
    workspaceRepository,
    careerCommandRepository: new SqliteCareerCommandRepository(database, sealedText, transaction),
    documentRepository,
    vacancyRepository: new SqliteVacancyRepository(database, sealedText),
    careerStrategyRepository: new SqliteCareerStrategyRepository(database, sealedText),
    workPreferenceRepository: new SqliteWorkPreferenceRepository(database, sealedText),
    candidateMediaRepository: new SqliteCandidateMediaRepository(database, sealedText),
  };
}
