import { DatabaseSync } from 'node:sqlite';
import { applySqliteBusyTimeout } from '../data/sqliteBusyTimeout';
import { readLinkedinPoolJobs } from './linkedinPoolSource';
import type { SourceReading } from './multiSourceVacancyEngine';
import { currentFanDemand } from './jobspyFan';
import { searchHhVacancies } from '../connectors/hhVacancySearch';
import { searchRemotiveVacancies } from '../connectors/remotiveVacancySearch';
import { HhCrawlCoordinator } from './hhCrawlCoordinator';
import { createHhCrawlSettings, type SqliteHhCrawlSettings } from './hhCrawlSettings';
import { buildHhPageFetcher } from './hhSearchTransport';
import { HhTextRateController } from './hhTextRate';
import { HhVacancyDescriptionLoader } from './hhVacancyDescription';
import { createHttpLinkProbe } from './linkLivenessProbe';
import { buildMultiSourceFetcher, fetchRobotsTxt } from './multiSourceFetcher';
import type { LinkProbe } from './linkLivenessProbe';
import {
  MultiSourceVacancyEngine,
  type ReclusterMode,
  type SourceFetcher,
} from './multiSourceVacancyEngine';
import type { LinkedinGuestBudget } from './linkedinGuestBudget';
import { planCompanyChannels, readDirectoryCompanies } from './companyDirectorySources';
import { DEFAULT_VACANCY_SOURCES, type RegisteredVacancySource } from './defaultVacancySources';
import { RobotsPolicyLoader, type RobotsFetcher } from './robotsPolicyLoader';
import { SqliteVacancyPoolStore, type PoolWriteEvent } from './sqliteVacancyPoolStore';

export interface ComposedVacancyEngine {
  readonly engine: MultiSourceVacancyEngine;
  readonly pool: SqliteVacancyPoolStore;
  readonly hhCrawlSettings: SqliteHhCrawlSettings;
  readonly hhCrawlCoordinator: HhCrawlCoordinator;
  close(): void;
}

export interface ComposeVacancyEngineOptions {
  readonly databasePath: string;
  /** Подмена сети в тестах: по умолчанию — настоящие площадки, robots и ссылки. */
  readonly fetcher?: SourceFetcher;
  readonly fetchRobots?: RobotsFetcher;
  readonly linkProbe?: LinkProbe;
  readonly recluster?: ReclusterMode;
  /** Свидетель транзакций записи пула — журнал обслуживателя (PRB-043 срез 2). */
  readonly onPoolWrite?: (event: PoolWriteEvent) => void;
  /** Ожидание между транзакциями записи кластеров: только у фонового процесса. */
  readonly clusterWritePause?: () => void;
  /** Подбор по смыслу вместо LIKE (B267 S3); по умолчанию старое поведение. */
  readonly matchMode?: 'legacy' | 'semantic';
  /** Общий бюджет гостевого LinkedIn процесса (B622): тот же отдаётся резолверу B621. */
  readonly linkedinBudget?: LinkedinGuestBudget;
}

function openPoolJobsDatabase(databasePath: string): DatabaseSync {
  const database = new DatabaseSync(databasePath);
  applySqliteBusyTimeout(database);
  return database;
}

function createPoolJobsReader(databasePath: string, hasVacancy: (id: string) => boolean) {
  let database: DatabaseSync | undefined;
  return {
    read: (): SourceReading => {
      database ??= openPoolJobsDatabase(databasePath);
      return readLinkedinPoolJobs(database, {
        now: new Date(),
        observedAt: new Date().toISOString(),
        hasVacancy,
      });
    },
    close: (): void => database?.close(),
  };
}

/**
 * Реестр с основными каналами компаний справочника (B622). Справочник
 * читается только на чтение; база без таблицы даёт прежний реестр с ярусами.
 */
export function registryWithCompanyChannels(databasePath: string): RegisteredVacancySource[] {
  let companies: ReturnType<typeof readDirectoryCompanies> = [];
  try {
    const database = new DatabaseSync(databasePath, { readOnly: true });
    try {
      companies = readDirectoryCompanies(database);
    } finally {
      database.close();
    }
  } catch {
    companies = [];
  }
  return [...planCompanyChannels(DEFAULT_VACANCY_SOURCES, companies).sources];
}

/**
 * Одна сборка движка пула для обоих процессов (B230): HTTP отвечает из пула,
 * обслуживатель его пополняет. Раньше всё это жило в `server/index.ts`, и
 * второй процесс неизбежно разошёлся бы с первым по набору площадок или
 * настройкам обхода — а расходятся они молча.
 */
export function composeVacancyEngine(options: ComposeVacancyEngineOptions): ComposedVacancyEngine {
  const pool = new SqliteVacancyPoolStore({
    databasePath: options.databasePath,
    ...(options.onPoolWrite ? { onWrite: options.onPoolWrite } : {}),
    ...(options.clusterWritePause ? { clusterWritePause: options.clusterWritePause } : {}),
    ...(options.matchMode ? { matchMode: options.matchMode } : {}),
  });
  // Настройки веера обхода hh.ru: набор ролей выбирает владелец, отметка
  // глубокого прохода переживает выкат (B214).
  const hhCrawlSettings = createHhCrawlSettings({ databasePath: options.databasePath });
  const hhPageFetcher = buildHhPageFetcher();
  const hhCrawlCoordinator = new HhCrawlCoordinator(hhCrawlSettings, {
    fetchPage: hhPageFetcher,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    // Быстрый проход останавливается на странице, где пул всё уже знает (B219).
    // Движок собирается ниже, поэтому спрашивается через замыкание, а не значением.
    isKnown: (id: string): boolean => engine.hasVacancy(id),
    // Роли кандидатов вне справочника hh ищутся по названию (27.10).
    demandTerms: currentFanDemand,
  });
  // Карточки пула LinkedIn читаются своим соединением и только при опросе источника.
  const poolJobs = createPoolJobsReader(options.databasePath, (id) => engine.hasVacancy(id));
  const engine: MultiSourceVacancyEngine = new MultiSourceVacancyEngine({
    sources: registryWithCompanyChannels(options.databasePath),
    fetcher:
      options.fetcher ??
      buildMultiSourceFetcher(searchHhVacancies, searchRemotiveVacancies, hhCrawlCoordinator, {
        readLinkedinPoolJobs: poolJobs.read,
        ...(options.linkedinBudget ? { linkedinBudget: options.linkedinBudget } : {}),
      }),
    pool,
    // Право обхода спрашивается у самой площадки, а не берётся из записи,
    // сделанной когда-то руками; `Crawl-delay` тоже приходит оттуда (B204).
    robots: new RobotsPolicyLoader({ fetchRobots: options.fetchRobots ?? fetchRobotsTxt }),
    // Открывается ли ещё ссылка объявления — отдельное доказательство: лента
    // может отдавать свежие даты у вакансий, которых на сайте уже нет (B200
    // срез 2).
    linkProbe: options.linkProbe ?? createHttpLinkProbe(),
    descriptionLoader: new HhVacancyDescriptionLoader({
      transport: hhPageFetcher,
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      // 03.11: адаптивный темп (старт 2/с, потолок 10/с); первый отказ делит его пополам.
      rate: new HhTextRateController(),
    }),
    ...(options.recluster ? { recluster: options.recluster } : {}),
  });
  return {
    engine,
    pool,
    hhCrawlSettings,
    hhCrawlCoordinator,
    close: () => {
      poolJobs.close();
      pool.close();
      hhCrawlSettings.close();
    },
  };
}
