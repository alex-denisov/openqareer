import type { DatabaseSync } from 'node:sqlite';
import type { SealedText } from './sealedText';
import { SqliteCareerDiaryRepository } from './sqliteCareerDiaryRepository';
import { SqliteCareerVectorRepository } from './sqliteCareerVectorRepository';
import { SqliteDecisionProfileRepository } from './sqliteDecisionProfileRepository';
import { SqliteProfileRevisionRepository } from './sqliteProfileRevisionRepository';
import { SqliteReferralTrackRepository } from './sqliteReferralTrackRepository';
import { SqliteRelocationQuestionnaireRepository } from './sqliteRelocationQuestionnaireRepository';
import { SqliteRoleSkillAssessmentRepository } from './sqliteRoleSkillAssessmentRepository';
import { SqliteStarPrepRepository } from './sqliteStarPrepRepository';
import { SqliteStarStoriesRepository } from './sqliteStarStoriesRepository';
import { SqliteInterviewSimulatorRepository } from './sqliteInterviewSimulatorRepository';

/** Репозитории профиля, дневника и переезда: общий набор, чтобы конструктор хранилища не рос. */
export function createProfileRepositories(
  database: DatabaseSync,
  sealedText: SealedText,
  transaction: <T>(operation: () => T) => T,
) {
  return {
    profileRevisionRepo: new SqliteProfileRevisionRepository(database, sealedText),
    starPrepRepo: new SqliteStarPrepRepository(database, sealedText),
    referralTrackRepo: new SqliteReferralTrackRepository(database, sealedText),
    careerVectorRepo: new SqliteCareerVectorRepository(database, sealedText),
    careerDiaryRepo: new SqliteCareerDiaryRepository(database, sealedText, transaction),
    decisionProfileRepo: new SqliteDecisionProfileRepository(database, sealedText),
    relocationQuestionnaireRepo: new SqliteRelocationQuestionnaireRepository(database, sealedText),
    roleSkillAssessments: new SqliteRoleSkillAssessmentRepository(database, sealedText),
    starStoriesRepo: new SqliteStarStoriesRepository(database, sealedText),
    interviewSimulatorRepo: new SqliteInterviewSimulatorRepository(database, sealedText),
  };
}
