import type {
  CareerDiaryAchievement,
  CareerDiaryGoal,
  CareerDiaryMeasurement,
  CareerDiaryWeeklyReview,
  CareerDiaryWorkplace,
} from '../../shared/careerDiary';
import type { SqliteCareerDiaryRepository } from './sqliteCareerDiaryRepository';
import type { DatabaseSync } from 'node:sqlite';
import { SqliteDiaryCheckpointRepository } from './sqliteDiaryCheckpointRepository';
import { SqliteDiaryDetailsRepository } from './sqliteDiaryDetailsRepository';
import { SqliteDiaryPeopleRepository } from './sqliteDiaryPeopleRepository';
import { SqliteKpiImportRepository } from './sqliteKpiImportRepository';
import { whenTableExists } from './exportTableReader';

type DetailsExport = ReturnType<SqliteDiaryDetailsRepository['exportAll']>;

/**
 * B689: всё, что кандидат записал в «Дневник» помимо записей, итогов недель, практик
 * интервью и заявок на адаптацию (у них свои ключи выгрузки). Счётчик попыток разбора KPI
 * не входит: в нём только время попыток.
 */
export interface CareerDiaryExport {
  readonly goals: CareerDiaryGoal[];
  readonly measurements: CareerDiaryMeasurement[];
  readonly goalDetails: DetailsExport['goals'];
  readonly weeklyReviews: CareerDiaryWeeklyReview[];
  readonly achievements: CareerDiaryAchievement[];
  readonly workplaces: CareerDiaryWorkplace[];
  readonly adaptationDetails: DetailsExport['adaptation'];
  readonly checkpoints: ReturnType<SqliteDiaryCheckpointRepository['exportAll']>;
  readonly people: ReturnType<SqliteDiaryPeopleRepository['exportAll']>;
  readonly kpiImports: ReturnType<SqliteKpiImportRepository['exportAll']>;
}

export interface CareerDiaryExportSources {
  readonly diary: Pick<
    SqliteCareerDiaryRepository,
    'listGoals' | 'listMeasurements' | 'listWeeklyReviewsPage' | 'listAchievements' | 'listWorkplaces'
  >;
  readonly details: Pick<SqliteDiaryDetailsRepository, 'exportAll'>;
  readonly checkpoints: Pick<SqliteDiaryCheckpointRepository, 'exportAll'>;
  readonly people: Pick<SqliteDiaryPeopleRepository, 'exportAll'>;
  readonly kpiImports: Pick<SqliteKpiImportRepository, 'exportAll'>;
}

/**
 * Читатели дневника на соединении хранилища. Маршруты пишут эти таблицы своими соединениями
 * с той же базой и тем же ключом; здесь только чтение.
 */
export function createCareerDiaryExportSources(
  database: DatabaseSync,
  encryptionKey: Buffer,
  diary: CareerDiaryExportSources['diary'],
): CareerDiaryExportSources {
  return {
    diary,
    details: {
      exportAll: whenTableExists(
        database,
        'career_diary_goal_details',
        () => new SqliteDiaryDetailsRepository(database, encryptionKey),
        (repository, candidateId) => repository.exportAll(candidateId),
        () => ({ goals: [], adaptation: [] }),
      ),
    },
    checkpoints: {
      exportAll: whenTableExists(
        database,
        'career_diary_checkpoints',
        () => new SqliteDiaryCheckpointRepository(database, encryptionKey),
        (repository, candidateId) => repository.exportAll(candidateId),
        () => [],
      ),
    },
    people: {
      exportAll: whenTableExists(
        database,
        'career_diary_people',
        () => new SqliteDiaryPeopleRepository(database, encryptionKey),
        (repository, candidateId) => repository.exportAll(candidateId),
        () => [],
      ),
    },
    kpiImports: {
      exportAll: whenTableExists(
        database,
        'career_diary_kpi_imports',
        () => new SqliteKpiImportRepository(database, encryptionKey),
        (repository, candidateId) => repository.exportAll(candidateId),
        () => [],
      ),
    },
  };
}

const REVIEW_PAGE = 100;

/** Прежние итоги недель целиком: обычный список отдаёт не больше двух лет. */
function allWeeklyReviews(
  diary: CareerDiaryExportSources['diary'],
  candidateId: string,
): CareerDiaryWeeklyReview[] {
  const reviews: CareerDiaryWeeklyReview[] = [];
  let cursor: string | undefined;
  do {
    const page = diary.listWeeklyReviewsPage(candidateId, REVIEW_PAGE, cursor);
    reviews.push(...page.items);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return reviews;
}

export function exportCareerDiary(
  sources: CareerDiaryExportSources,
  candidateId: string,
): CareerDiaryExport {
  const goals = sources.diary.listGoals(candidateId);
  const details = sources.details.exportAll(candidateId);
  return {
    goals,
    measurements: goals.flatMap((goal) => sources.diary.listMeasurements(candidateId, goal.id)),
    goalDetails: details.goals,
    weeklyReviews: allWeeklyReviews(sources.diary, candidateId),
    achievements: sources.diary.listAchievements(candidateId),
    workplaces: sources.diary.listWorkplaces(candidateId),
    adaptationDetails: details.adaptation,
    checkpoints: sources.checkpoints.exportAll(candidateId),
    people: sources.people.exportAll(candidateId),
    kpiImports: sources.kpiImports.exportAll(candidateId),
  };
}
