import { readRolloutPlacementBoards } from './placementBoardRollout';
import { abortableSleep } from './abortableSleep';
import { readVerifiedRequestedAts } from './verifiedRequestedAts';
import { DatabaseSync } from 'node:sqlite';
import { applySqliteBusyTimeout } from '../data/sqliteBusyTimeout';
import { readLinkedinPoolJobs } from './linkedinPoolSource';
import type { SourceReading } from './multiSourceVacancyEngine';
import { currentFanDemand } from './jobspyFan';
import { searchHhVacancies } from '../connectors/hhVacancySearch';
import { searchRemotiveVacancies } from '../connectors/remotiveVacancySearch';
import { HhCrawlCoordinator } from './hhCrawlCoordinator';
import { createHhCrawlSettings, type SqliteHhCrawlSettings } from './hhCrawlSettings';
import { buildHhPageFetcher, type HhFetchEvent } from './hhSearchTransport';
import type { HhSearchTransport } from './hhSearchFetcher';
import { HhTextRateController } from './hhTextRate';
import { HhVacancyDescriptionLoader } from './hhVacancyDescription';
import { createHttpLinkProbe } from './linkLivenessProbe';
import {
  buildMultiSourceFetcher,
  createRobotsFetcher,
  type MultiSourceFetcherDeps,
} from './multiSourceFetcher';
import { createHostRequestPacer, type HostRequestPacer } from './hostRequestPacer';
import type { LinkProbe } from './linkLivenessProbe';
import {
  MultiSourceVacancyEngine,
  type ReclusterMode,
  type SourceFetcher,
} from './multiSourceVacancyEngine';
import type { LinkedinGuestBudget } from './linkedinGuestBudget';
import type { VacancySourceConfig } from '../domain/unifiedVacancy';
import {
  planCompanyChannels,
  readChannelHealthSummary,
  readDirectoryCompanies,
  readDirectoryCompaniesAsync,
  resolveCompanyChannel,
  type PlanCompanyChannelsOptions,
  type ResolvedCompanyChannel,
} from './companyDirectorySources';
import { DEFAULT_VACANCY_SOURCES, type RegisteredVacancySource } from './defaultVacancySources';
import { RobotsPolicyLoader, type RobotsFetcher } from './robotsPolicyLoader';
import { SqliteVacancyPoolStore, type PoolWriteEvent } from './sqliteVacancyPoolStore';
import type { RenderScriptPage } from './scriptPageRenderer';

export interface ComposedVacancyEngine {
  readonly engine: MultiSourceVacancyEngine;
  readonly pool: SqliteVacancyPoolStore;
  readonly hhCrawlSettings: SqliteHhCrawlSettings;
  readonly hhCrawlCoordinator: HhCrawlCoordinator;
  close(): void;
}

export interface ComposeVacancyEngineOptions {
  readonly databasePath: string;
  readonly registerRequestedAts?: boolean;
  /** Подмена сети в тестах: по умолчанию — настоящие площадки, robots и ссылки. */
  readonly fetcher?: SourceFetcher;
  readonly fetchRobots?: RobotsFetcher;
  readonly linkProbe?: LinkProbe;
  readonly recluster?: ReclusterMode;
  /** Свидетель транзакций записи пула — журнал обслуживателя (PRB-043 срез 2). */
  readonly onPoolWrite?: (event: PoolWriteEvent) => void;
  /** Каждая прямая выборка hh.ru: время до заголовков, тело, задержка цикла (B756). */
  readonly onHhFetch?: (event: HhFetchEvent) => void;
  /** Прямая выборка hh.ru в своём потоке (B756): строка и замеры приходят сообщением. */
  readonly hhDirect?: HhSearchTransport;
  /** Остановка процесса (B759): обход hh сохраняет курсор по прочитанному и выходит. */
  readonly signal?: AbortSignal;
  /** Ожидание между транзакциями записи кластеров: только у фонового процесса. */
  readonly clusterWritePause?: () => void;
  /** Подбор по смыслу вместо LIKE (B267 S3); по умолчанию старое поведение. */
  readonly matchMode?: 'legacy' | 'semantic';
  /** Общий бюджет гостевого LinkedIn процесса (B622): тот же отдаётся резолверу B621. */
  readonly linkedinBudget?: LinkedinGuestBudget;
  /** B626: fetch для linkedin.com через ротацию Webshare. */
  readonly linkedinFetch?: typeof fetch;
  /** B643: рендер страниц карьеры, нарисованных скриптом; только у фонового процесса. */
  readonly renderScriptPage?: RenderScriptPage;
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
  let healthOptions: PlanCompanyChannelsOptions = {};
  try {
    const database = new DatabaseSync(databasePath, { readOnly: true });
    try {
      companies = [
        ...readDirectoryCompanies(database),
        ...readRolloutPlacementBoards(database, Date.now()),
      ];
      healthOptions = readChannelHealthSummary(database, Date.now());
    } finally {
      database.close();
    }
  } catch {
    companies = [];
    healthOptions = {};
  }
  return [...planCompanyChannels(DEFAULT_VACANCY_SOURCES, companies, healthOptions).sources];
}

/**
 * Неблокирующее обновление каналов компаний справочника и роллаута в работающем
 * движке без перезапуска процесса обслуживания (Phase 0).
 */
export async function refreshCompanyChannelsAsync(
  databasePath: string,
  engine: Pick<MultiSourceVacancyEngine, 'syncDirectoryChannels'>,
  shouldStop: () => boolean = () => false,
): Promise<{ added: number; updated: number; disabled: number; total: number }> {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const nowMs = Date.now();
    const companies = [
      ...(await readDirectoryCompaniesAsync(database, undefined, shouldStop)),
      ...readRolloutPlacementBoards(database, nowMs),
    ];
    if (shouldStop()) return { added: 0, updated: 0, disabled: 0, total: 0 };
    const healthOptions = readChannelHealthSummary(database, nowMs);
    const plan = planCompanyChannels(DEFAULT_VACANCY_SOURCES, companies, healthOptions);
    return engine.syncDirectoryChannels(plan.sources);
  } finally {
    database.close();
  }
}

const DIRECTORY_REFRESH_INTERVAL_MS = 15 * 60_000;

interface DirectoryRefreshLog {
  info(context: Record<string, unknown>, message: string): void;
  error(context: Record<string, unknown>, message: string): void;
}

/**
 * Запускает периодическое фоновое обновление каналов справочника в `maintenance`
 * без перезапуска процесса и без удержания event loop.
 */
export function scheduleDirectoryChannelRefresh(
  databasePath: string,
  engine: Pick<MultiSourceVacancyEngine, 'syncDirectoryChannels'>,
  log: DirectoryRefreshLog,
  shouldStop: () => boolean,
  intervalMs = DIRECTORY_REFRESH_INTERVAL_MS,
): () => void {
  let running = false;
  const timer = setInterval(() => {
    if (shouldStop() || running) return;
    running = true;
    const startedAt = Date.now();
    void refreshCompanyChannelsAsync(databasePath, engine, shouldStop)
      .then((result) => {
        if (result.added + result.updated + result.disabled > 0) {
          log.info({ ...result, ms: Date.now() - startedAt }, 'directory-channels-refreshed');
        }
      })
      .catch((error: unknown) => {
        log.error(
          {
            errorName: error instanceof Error ? error.name : 'UnknownError',
            message: error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200),
          },
          'directory-channels-refresh-failed',
        );
      })
      .finally(() => {
        running = false;
      });
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}

function resolveCompanyChannelFromDb(
  databasePath: string,
  companyKey: string,
): ResolvedCompanyChannel | undefined {
  try {
    const database = new DatabaseSync(databasePath, { readOnly: true });
    try {
      return resolveCompanyChannel(database, DEFAULT_VACANCY_SOURCES, companyKey, Date.now());
    } finally {
      database.close();
    }
  } catch {
    return undefined;
  }
}

/**
 * Одна сборка движка пула для обоих процессов (B230): HTTP отвечает из пула,
 * обслуживатель его пополняет. Раньше всё это жило в `server/index.ts`, и
 * второй процесс неизбежно разошёлся бы с первым по набору площадок или
 * настройкам обхода — а расходятся они молча.
 */
function buildFetcher(
  options: ComposeVacancyEngineOptions,
  hhCrawlCoordinator: HhCrawlCoordinator,
  readLinkedinPoolJobs: NonNullable<MultiSourceFetcherDeps['readLinkedinPoolJobs']>,
  hostPacer: HostRequestPacer,
) {
  return buildMultiSourceFetcher(searchHhVacancies, searchRemotiveVacancies, hhCrawlCoordinator, {
    readLinkedinPoolJobs,
    hostPacer,
    ...(options.linkedinBudget ? { linkedinBudget: options.linkedinBudget } : {}),
    ...(options.linkedinFetch ? { linkedinFetch: options.linkedinFetch } : {}),
    ...(options.renderScriptPage ? { renderScriptPage: options.renderScriptPage } : {}),
  });
}

function hostOfTarget(targetUrl: string): string {
  try {
    return new URL(targetUrl).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function createHoldSource(
  linkedinBudget: ComposeVacancyEngineOptions['linkedinBudget'],
  hostPacer: ReturnType<typeof createHostRequestPacer>,
): (source: VacancySourceConfig) => boolean {
  const linkedinHold = linkedinBudget ? holdDuringLinkedinPause(linkedinBudget) : undefined;
  return (source) => {
    if (linkedinHold?.(source)) return true;
    const host = hostOfTarget(source.targetUrl);
    return host !== '' && hostPacer.isLongPaused(host);
  };
}

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
  const hhPageFetcher = buildHhPageFetcher(process.env, options.onHhFetch, options.hhDirect);
  const hhCrawlCoordinator = new HhCrawlCoordinator(hhCrawlSettings, {
    fetchPage: hhPageFetcher,
    sleep: (ms) => abortableSleep(ms, options.signal),
    ...(options.signal ? { signal: options.signal } : {}),
    // Быстрый проход останавливается на странице, где пул всё уже знает (B219).
    // Движок собирается ниже, поэтому спрашивается через замыкание, а не значением.
    isKnown: (id: string): boolean => engine.hasVacancy(id),
    demandTerms: currentFanDemand,
  });
  const poolJobs = createPoolJobsReader(options.databasePath, (id) => engine.hasVacancy(id));
  const hostPacer = createHostRequestPacer();
  const engine: MultiSourceVacancyEngine = new MultiSourceVacancyEngine({
    sources: registryWithCompanyChannels(options.databasePath),
    ...(options.registerRequestedAts
      ? { loadRequestedSource: (sourceId) => readVerifiedRequestedAts(options.databasePath, sourceId) }
      : {}),
    replanCompanyChannel: (companyKey) => resolveCompanyChannelFromDb(options.databasePath, companyKey),
    holdSource: createHoldSource(options.linkedinBudget, hostPacer),
    fetcher: options.fetcher ?? buildFetcher(options, hhCrawlCoordinator, poolJobs.read, hostPacer),
    pool,
    robots: new RobotsPolicyLoader({ fetchRobots: options.fetchRobots ?? createRobotsFetcher(hostPacer) }),
    linkProbe: options.linkProbe ?? createHttpLinkProbe(),
    descriptionLoader: new HhVacancyDescriptionLoader({
      transport: hhPageFetcher,
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      rate: new HhTextRateController(),
    }),
    ...(options.recluster ? { recluster: options.recluster } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
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

const LINKEDIN_GUEST_SOURCE_ID = 'src-linkedin-guest';

export function holdDuringLinkedinPause(
  budget: LinkedinGuestBudget,
): (source: VacancySourceConfig) => boolean {
  return (source) =>
    (Boolean(source.linkedinOrgId) || source.id === LINKEDIN_GUEST_SOURCE_ID) && budget.isPaused();
}
