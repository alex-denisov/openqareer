import { failureMessage } from './requestTimeout';
import type { HhTextRateController } from './hhTextRate';
/* eslint-disable max-lines -- source synchronization and membership lifecycle
   are intentionally kept together so replacement, expiry and reclustering share
   one transaction boundary. */
import { parseAtsBoardSourceId } from './atsBoardAdapters';
import type { ChipCounts } from './catalogChips';
import type { CatalogChipQuery } from './vacancyPoolStore';
import type { SalaryStats } from './catalogSalaryStats';
import { compareMatchedVacancies } from '../../shared/vacancyMatchOrder';
import { extractSkillsFromText } from '../connectors/telegramChannelParser';
import type {
  UnifiedVacancy,
  VacancyCluster,
  VacancyMatchExplanation,
  VacancySourceConfig,
} from '../domain/unifiedVacancy';
import {
  calculateSourceAuthenticity,
  clusterVacancies,
  clusterVacanciesAsync,
  IncrementalClusterBuilder,
  memberKeysOf,
} from './vacancyDeduplicator';
import { DEFAULT_VACANCY_SOURCES } from './defaultVacancySources';
import { mapWithConcurrency } from './boundedConcurrency';
import {
  DEFAULT_LINK_SAMPLE,
  probeVacancyLinks,
  type LinkCheckCensus,
  type LinkProbe,
} from './linkLivenessProbe';
import type { RobotsPolicyLoader } from './robotsPolicyLoader';
import {
  censusOfReading,
  describeSourceHealth,
  emptySourceObservations,
  isDeadSource,
  recordLinkCheck,
  recordReading,
  type SourceAddressRight,
  type SourceHealth,
  type SourceObservations,
} from './sourceHealthVerdict';
import { matchCandidateWithVacancy, type CandidateMatchProfile } from './vacancyMatcher';
import { MemoryVacancyPoolStore } from './memoryVacancyPoolStore';
import {
  freshnessWindow,
  isWithin,
  parseMs,
  MAX_VACANCY_AGE_DAYS,
  clusterProjectionOf,
} from './vacancyPoolQuery';
import type { VacancyLink, VacancyPoolStore } from './vacancyPoolStore';
import {
  clusterBatchByKeys,
  detachVacanciesByKeys,
  type KeyedClusterStore,
} from './keyedClusterer';
import type {
  CatalogEntriesPage,
  CatalogEntriesQuery,
  CatalogEntryRow,
} from './vacancyCatalogProjection';
import type { CatalogListingSummary } from './vacancyCatalogFacets';

import { PoliteScheduler, type SourceScheduleInfo } from './politeScheduler';
import {
  HH_TEXT_CONCURRENCY,
  HH_TEXT_PER_TICK,
  HH_TEXT_TICK_MS,
  HhCatalogTextBackfill,
  type HhCatalogTextReport,
} from './hhCatalogText';
import { expireClusterSources } from './clusterExpiry';
import { HH_SEARCH_SOURCE_ID } from './hhSearchState';
import { mapYielding } from './mapYielding';
import type { CatalogTotals } from './matchedCatalogSummary';
import {
  COMPANY_LANE_CONCURRENCY,
  COMPANY_LANE_LIMIT,
  companyLanePerHost,
  COMPANY_LANE_SOURCE_TIMEOUT_MS,
  pickCompanyLane,
  pickWave,
} from './syncWave';
import {
  WorkdayDescriptionBackfill,
  type WorkdayDescriptionReport,
  type WorkdayDetailFetch,
} from './workdayDescriptions';

/**
 * Улов одного опроса. Простой список означает полное чтение: площадка показала
 * весь свой срез, и то, чего в нём нет, снято (B161).
 *
 * `partial: true` означает частичное чтение — источник показал только часть
 * своей выдачи и о судьбе остального ничего не сказал. Такое чтение обязано
 * дополнять срез, а не заменять его: быстрый проход по свежим суткам hh.ru
 * однажды заменил 36 376 собранных вакансий на 1 464 прочитанных (B214).
 */
export interface SourceReading {
  readonly vacancies: UnifiedVacancy[];
  readonly partial: boolean;
  /**
   * Итог растянутого на тики полного перечисления (B219): записи этого
   * источника, которых ни один тик не видел с этого момента, площадка больше
   * не показывает — они снимаются. Только вместе с `partial: true`.
   */
  readonly dropObservedBefore?: string;
}

export type SourceFetcher = (
  source: VacancySourceConfig,
  options?: { query?: string },
) => Promise<UnifiedVacancy[] | SourceReading>;

export interface VacancyDescriptionLoaded {
  readonly description?: string;
  readonly skills?: readonly string[];
  readonly archived?: boolean;
  /** Площадка отказала нам (`refused`) или загрузчик выжидает после отказа (`backoff`). */
  readonly blocked?: 'refused' | 'backoff';
  /** Работодатель ограничил доступ к карточке (02.11). */
  readonly restricted?: boolean;
}

/** Читает полный текст только когда кандидат дошёл до конкретной вакансии. */
export interface VacancyDescriptionLoader {
  load(url: string): Promise<VacancyDescriptionLoaded | string | undefined>;
  isLoaded?(url: string): boolean;
  /** 03.11: адаптивный темп загрузчика; без него остаются фиксированные порция и конвейер. */
  rateControl?(): HhTextRateController | undefined;
}

export interface VacancyDescriptionLoadResult {
  readonly vacancy?: UnifiedVacancy;
  /** Площадка отказала или не дала разметку: UI не должен выдавать сниппет за полный текст. */
  readonly unavailable: boolean;
  readonly status: 'loaded' | 'cached' | 'skipped' | 'failed';
  /** Отказ — признак блокировки площадки, а не сбой одной карточки (B535). */
  readonly blocked?: 'refused' | 'backoff';
  /** Текст скрыт работодателем насовсем: строка ушла из очередей текста (02.11). */
  readonly restricted?: boolean;
}

export interface VacancyDescriptionPreloadSummary {
  readonly requested: number;
  readonly loaded: number;
  readonly skipped: number;
  readonly failed: number;
}

const MAX_PERSISTED_DESCRIPTION_IDS = 2_000;
/** How long catalog listing counts are reused between maintenance passes. */
const LISTINGS_CACHE_MS = 5 * 60_000;

/**
 * What one sync actually did. `syncSource` used to return `void`, so an admin
 * route could only answer `success: true` — including for a run that failed
 * outright and for a source id that does not exist (B161 review §3).
 */
export interface SourceSyncOutcome {
  readonly sourceId: string;
  readonly status:
    | 'healthy'
    | 'error'
    | 'unknown_source'
    | 'disabled'
    | 'skipped_needs_query'
    /** B628: канал компании не ответил за отведённое полосе время; опрос идёт дальше в фоне. */
    | 'lane_timeout';
  /** How many records the source returned before the freshness filter. */
  readonly fetched: number;
  /** How many of them the pool now holds for this source. */
  readonly kept: number;
  readonly message?: string;
  /** A full reading that would have wiped most of the slice and was merged instead. */
  readonly replaceRefused?: ReplaceRefusal;
}

export interface ReplaceRefusal {
  readonly existing: number;
  readonly fetched: number;
}

/**
 * Охрана среза: «полное» чтение, после которого от большого среза осталось бы
 * меньше половины, не заменяет его, а дополняет. 27.10 одна синхронизация
 * Indeed из 534 записей так стёрла 169 577 вакансий: чтение окна веера было
 * объявлено полным. Настоящее опустение площадки заметит уборка по сроку и
 * проверка живости ссылок, а не одно чтение.
 */
export const REPLACE_GUARD_MIN_SLICE = 200;
export const REPLACE_GUARD_MAX_REMOVED_SHARE = 0.5;

export function refusesSliceReplace(existing: number, fetched: number): boolean {
  if (existing < REPLACE_GUARD_MIN_SLICE) return false;
  return existing - fetched > existing * REPLACE_GUARD_MAX_REMOVED_SHARE;
}

export interface RequestedSourceSync {
  readonly sourceId: string;
  readonly requestedAt: string;
  readonly startedAt?: string;
}

export interface ManualSourceSyncState {
  readonly status: 'ready' | 'queued' | 'running';
  readonly requestedAt?: string;
  readonly startedAt?: string;
}

export interface MatchedVacancyItem {
  cluster: VacancyCluster;
  explanation: VacancyMatchExplanation;
}

export interface VacancyQueryFilter {
  sourceId?: string;
  type?: string;
  query?: string;
  isRemote?: boolean;
  limit?: number;
  offset?: number;
}

/** Здоровье одной площадки вместе с её именем: админка печатает оба (B200). */
export interface SourceHealthReportItem extends SourceHealth {
  readonly sourceId: string;
  readonly sourceName: string;
  readonly schedule?: SourceScheduleInfo;
}

export interface VacancyQueryResult {
  total: number;
  items: UnifiedVacancy[];
  statsBySource: Array<{ sourceId: string; sourceName: string; count: number }>;
}

export interface SourceOwnershipAudit {
  readonly totalStoredRows: number;
  readonly activeRows: number;
  readonly registeredSourcesWithRows: number;
  readonly orphaned: readonly {
    sourceId: string;
    total: number;
    active: number;
  }[];
}

function isVacancyFresh(publishedAt: string, nowMs: number = Date.now()): boolean {
  return isWithin(parseMs(publishedAt), freshnessWindow(nowMs));
}

function vacancyMembershipFields(vacancy: UnifiedVacancy): string {
  return JSON.stringify({
    title: vacancy.title,
    company: vacancy.company,
    description: vacancy.description,
    requiredSkills: vacancy.requiredSkills,
    url: vacancy.url,
    location: vacancy.location,
    salary: vacancy.salary,
  });
}

function hasChangedExistingMembership(
  pool: VacancyPoolStore,
  vacancies: readonly UnifiedVacancy[],
): boolean {
  return vacancies.some((vacancy) => {
    const previous = pool.getVacancy(vacancy.id);
    return (
      previous !== undefined &&
      vacancyMembershipFields(previous) !== vacancyMembershipFields(vacancy)
    );
  });
}

/**
 * Сколько площадок плановый опрос берёт за один такт (такт — 5 минут,
 * `server/index.ts`). Доски работодателей исчисляются сотнями и после запуска
 * процесса все до одной «пора опросить»: залп из сотен одновременных запросов —
 * это и невежливо к чужим серверам, и мегабайты ответов в памяти одного
 * процесса. Партия берётся с самых давно не опрошенных, поэтому очередь
 * проходит целиком, а не по кругу первым двенадцати (B202).
 */
export const SYNC_BATCH_LIMIT = 12;

/**
 * B622: основной канал компании (ярус 1) идёт в волну первым, прочие доски
 * (ярус 2) опрашиваются вдвое реже своего интервала, агрегаторы (ярус 3) —
 * в свой интервал, но после каналов компаний.
 */
const TIER_INTERVAL_FACTOR: Readonly<Record<1 | 2 | 3, number>> = { 1: 1, 2: 2, 3: 1 };

function sourceHost(source: VacancySourceConfig): string {
  try {
    return new URL(source.targetUrl).hostname.toLowerCase();
  } catch {
    return source.id;
  }
}

function tierOf(source: VacancySourceConfig): 1 | 2 | 3 {
  return source.channelTier ?? 3;
}

/** Приостановленную площадку перепроверяют не чаще этого срока. */
export const DEAD_SOURCE_RECHECK_MS = 7 * 24 * 60 * 60 * 1000;

/** Столько приостановленных площадок идёт за такт: после старта они не уходят залпом. */
const DEAD_SOURCE_RECHECKS_PER_TICK = 1;

/**
 * Перепроверка ссылок идёт шире обычной выборки: улов уже записан, и вакансии
 * с нерабочими ссылками нужно снять до пересборки кластеров.
 */
const DEAD_SOURCE_LINK_SAMPLE = 100;

/**
 * Как движок пересобирает кластеры после волны опроса.
 *
 * `sync` — сразу и в этом же вызове: тесты и маленькие пулы. `background` —
 * асинхронно, уступая цикл событий, и не чаще раза в `minIntervalMs`; чтение
 * никогда не ждёт сборки и отдаёт текущие кластеры. На проде разбор 173 000
 * записей из базы стоит 1–2 минуты процессора: синхронная сборка на каждую
 * пятиминутную волну держала службу без ответа и была откачена
 * (2026-09-15, B221). Полная пересборка уходит со срезом 3.
 *
 * `off` — запрет полной пересборки (B230): пул и состояние площадок пишутся,
 * кластеры не трогаются ни синхронно, ни в фоне, а явный вызов бросает
 * ошибку. Это режим HTTP-процесса на проде, где весь пул в кучу не входит.
 *
 * `keyed` — сведение по ключам (B230): каждый улов сводится партиями с
 * кластерами, которые задели его ключи в `vacancy_cluster_keys`; ушедшие из
 * среза записи снимаются с кластеров точечно. Полная пересборка запрещена
 * так же, как в `off`. Это режим обслуживателя.
 */
export type ReclusterMode =
  | { mode: 'sync' }
  | { mode: 'background'; minIntervalMs: number }
  | { mode: 'off' }
  | { mode: 'keyed'; batchSize: number };

/**
 * Сколько записей одной партии сведения по ключам (B230). Партия идёт одним
 * куском, поэтому её размер задаёт стоянку очереди событий. Прод 05.11, 1000
 * вакансий hh: партия 500 дала 15,8 с за раз и 28 с всего, партия 10 дала 1,7 с
 * за раз и 31 с всего: 71 с из 75 в профиле уходит на чтение кандидатов.
 */
export const DEFAULT_KEYED_BATCH_SIZE = 10;

/** Режимы, в которых полная пересборка кластеров запрещена. */
function forbidsFullRecluster(mode: ReclusterMode): boolean {
  return mode.mode === 'off' || mode.mode === 'keyed';
}

/** HTTP `off` never contacts a source; the maintenance process owns fetches. */
function forbidsDirectSourceSync(mode: ReclusterMode): boolean {
  return mode.mode === 'off';
}

export class ReclusterDisabledError extends Error {
  constructor(message = 'recluster is off: full cluster rebuild is banned in this process') {
    super(message);
    this.name = 'ReclusterDisabledError';
  }
}

export const DEFAULT_RECLUSTER_MIN_INTERVAL_MS = 15 * 60 * 1000;

function lastSyncMs(source: VacancySourceConfig): number {
  if (!source.lastSyncAt) return 0;
  const parsed = Date.parse(source.lastSyncAt);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function statusFromMessage(message: unknown): number | undefined {
  const match =
    typeof message === 'string' ? message.match(/vacancy_source_unreachable: (\d{3})\b/) : null;
  return match ? Number(match[1]) : undefined;
}

/** Polls in a row that must answer 404 before an ATS board counts as closed. */
const BOARD_CLOSED_AFTER_NOT_FOUND = 3;

function extractErrorHttpDetails(err: unknown): { statusCode?: number; retryAfterHeader?: string } {
  if (!err || typeof err !== 'object') return {};
  const obj = err as Record<string, unknown>;
  const statusCode =
    typeof obj.statusCode === 'number'
      ? obj.statusCode
      : typeof obj.status === 'number'
        ? obj.status
        : typeof (obj.response as Record<string, unknown> | undefined)?.status === 'number'
          ? ((obj.response as Record<string, unknown>).status as number)
          : statusFromMessage(obj.message);

  const headers =
    (obj.headers as { get?: (k: string) => string | null } | undefined) ??
    ((obj.response as Record<string, unknown> | undefined)?.headers as
      { get?: (k: string) => string | null } | undefined);

  let retryAfterHeader =
    typeof headers?.get === 'function' ? headers.get('retry-after') : undefined;

  const message = err instanceof Error ? err.message : String(err);
  let resolvedStatus = statusCode;
  if (!resolvedStatus) {
    if (message.includes('429')) resolvedStatus = 429;
    else if (message.includes('403')) resolvedStatus = 403;
    else if (message.includes('503')) resolvedStatus = 503;
  }
  if (!retryAfterHeader) {
    const match = message.match(/retry-after:\s*([^\s,]+)/iu);
    if (match) retryAfterHeader = match[1];
  }

  return { statusCode: resolvedStatus, retryAfterHeader: retryAfterHeader ?? undefined };
}

export class MultiSourceVacancyEngine {
  private listingsCache: { at: number; value: CatalogListingSummary[] | undefined } | null = null;
  /** Whole-catalog total: the one count no listing summary covers. */
  private rootTotalCache: { at: number; total: number } | null = null;
  private readonly now: () => number = () => Date.now();

  private sources: Map<string, VacancySourceConfig> = new Map();
  private clusters: VacancyCluster[] = [];
  private clusterBuilder?: IncrementalClusterBuilder;
  private pendingVacancies: UnifiedVacancy[] = [];
  /** A complete source replacement invalidates the old cluster membership. */
  private requiresFullRecluster = false;
  /** Сколько уловов сведено по ключам (B230) — для журнала обслуживателя. */
  private keyedClusterings = 0;
  private fetcher?: SourceFetcher;
  private readonly holdSource: (source: VacancySourceConfig) => boolean;
  private readonly companyLaneSourceTimeoutMs: number;
  /**
   * Где лежит пул. Движок не держит копию в куче: каждое чтение — вопрос к
   * хранилищу, и память следует за размером запроса, а не пула (B221). Без
   * базы (тесты) это пул в памяти с теми же ответами.
   */
  private readonly pool: VacancyPoolStore;
  /** In-flight syncs, so a slow source cannot be started twice at once. */
  private running: Map<string, Promise<SourceSyncOutcome>> = new Map();
  /** Что опросы установили про каждую площадку — вход живости и доверия (B200). */
  private observations: Map<string, SourceObservations> = new Map();
  /** Право читать площадку из реестра B199; без записи право не установлено. */
  private rights: Map<string, SourceAddressRight> = new Map();
  /** Когда обход ссылок последний раз доходил до площадки (B200 срез 2). */
  private linkCheckedAt: Map<string, number> = new Map();
  /** Вежливый диспетчер опроса: отступ, retry-after, бюджет и адаптация (B204). */
  private readonly scheduler: PoliteScheduler = new PoliteScheduler();
  /** Принесла ли волна что-то новое в пул с последней пересборки кластеров. */
  private poolChangedSinceRecluster = false;
  private reclusterCount = 0;
  private readonly reclusterMode: ReclusterMode;
  /** Идущая фоновая сборка; вторая параллельно не запускается. */
  private reclusterInFlight?: Promise<void>;
  /** Когда фоновая сборка закончилась в последний раз (мс). */
  private reclusterFinishedAt = 0;
  private lastReclusterMs = 0;
  private reclusterTimer?: ReturnType<typeof setTimeout>;

  /**
   * Кто спрашивает у площадки её `robots.txt`. Без него право берётся из
   * реестра — из замера, сделанного когда-то руками; с ним площадка называет
   * своё правило сама (B204).
   */
  private readonly robots?: RobotsPolicyLoader;

  /**
   * Кто ходит по ссылке объявления. Без него обход не делается вовсе: живость
   * ссылок — измерение, а не догадка, и выдумывать её нельзя (B200 срез 2).
   */
  private readonly linkProbe?: LinkProbe;
  private readonly descriptionLoader?: VacancyDescriptionLoader;
  private readonly descriptionLoads = new Map<string, Promise<VacancyDescriptionLoadResult>>();
  private readonly workdayDetailFetch?: WorkdayDetailFetch;
  private workdayDescriptions?: WorkdayDescriptionBackfill;
  private hhCatalogText?: HhCatalogTextBackfill;
  private lastHhSideStepAt = 0;
  /** Successful fetches become cached only after the pool write also succeeds. */
  private readonly persistedDescriptionIds = new Set<string>();

  constructor(options?: {
    sources?: VacancySourceConfig[];
    fetcher?: SourceFetcher;
    pool?: VacancyPoolStore;
    robots?: RobotsPolicyLoader;
    linkProbe?: LinkProbe;
    descriptionLoader?: VacancyDescriptionLoader;
    recluster?: ReclusterMode;
    /** Роли кандидатов для очереди текста hh (02.11); без них очередь — каталог и пул. */
    workdayDetailFetch?: WorkdayDetailFetch;
    /** Источник сейчас нельзя опрашивать (пауза бюджета LinkedIn): место в волне не занимает. */
    holdSource?: (source: VacancySourceConfig) => boolean;
    /** B628: сколько полоса каналов компаний ждёт один источник, прежде чем освободить место. */
    companyLaneSourceTimeoutMs?: number;
  }) {
    this.holdSource = options?.holdSource ?? (() => false);
    this.companyLaneSourceTimeoutMs =
      options?.companyLaneSourceTimeoutMs ?? COMPANY_LANE_SOURCE_TIMEOUT_MS;
    this.reclusterMode = options?.recluster ?? { mode: 'sync' };
    const initial = options?.sources ?? DEFAULT_VACANCY_SOURCES;
    for (const src of initial) {
      this.sources.set(src.id, { ...src });
      this.rememberRight(src);
      this.configureSourcePoliteness(src);
    }
    this.fetcher = options?.fetcher;
    this.pool = options?.pool ?? new MemoryVacancyPoolStore();
    this.robots = options?.robots;
    this.linkProbe = options?.linkProbe;
    this.descriptionLoader = options?.descriptionLoader;
    this.workdayDetailFetch = options?.workdayDetailFetch;
    // Source state is a small bounded registry, unlike the vacancy/cluster
    // pool. Load it immediately so the HTTP admin surface can show a durable
    // manual-sync request without hydrating any pool rows (B231).
    this.restoreSourceStates();
  }

  private configureSourcePoliteness(source: VacancySourceConfig): void {
    const addressStatus = (source as { addressStatus?: string }).addressStatus;
    if (addressStatus === 'robots_forbidden') {
      this.scheduler.setRobotsPolicy(source.id, { verdict: 'disallowed' });
    } else {
      this.scheduler.setRobotsPolicy(source.id, { verdict: 'allowed' });
    }
    if (source.lastSyncAt) {
      const parsed = Date.parse(source.lastSyncAt);
      if (!Number.isNaN(parsed)) {
        this.scheduler.recordAttempt(source.id, { success: true, nowMs: parsed });
      }
    }
  }

  private restoreSourceStates(): void {
    for (const state of this.pool.loadSourceStates()) {
      const source = this.sources.get(state.sourceId);
      if (!source) continue;
      source.lastSyncAt = state.lastSyncAt;
      source.lastStatus = state.lastStatus;
      // A disabled source is not failing: its registry reason says why it is
      // off, so an error stored before it was switched off is stale (03.11).
      source.lastErrorMessage = source.enabled ? state.lastErrorMessage : undefined;
      source.itemsFoundTotal = state.itemsFoundTotal;
      source.itemsActiveTotal = state.itemsActiveTotal;
      // The snapshot is written by the last successful sync. A source that is
      // not healthy (disabled, failing) never refreshes it while its rows
      // expire, so the admin kept showing 41 271 for an empty slice
      // (2026-11-03). One indexed point count per such source, not per start.
      if (state.lastStatus !== 'healthy' && state.itemsFoundTotal > 0) {
        const slice = this.pool.countSourceSlice(source.id);
        source.itemsFoundTotal = slice.total;
        source.itemsActiveTotal = slice.active;
      }
      source.syncRequestedAt = state.syncRequestedAt;
      source.syncStartedAt = state.syncStartedAt;
      if (state.observations) {
        this.observations.set(state.sourceId, state.observations);
        if (state.observations.schedule) {
          this.scheduler.importState({ [state.sourceId]: state.observations.schedule });
        }
      }
    }
  }

  /**
   * Loads what an earlier process synced. Without it a restart — and therefore
   * every deploy — served an empty «Возможности» until the scheduler's next
   * run, and every source claimed it had never been read (B164).
   *
   * Since B221 nothing is lifted into the heap: the store is pruned, source
   * states are read back, and the pool is served from the store as it is.
   */
  public restore(nowMs: number = Date.now()): { restored: number } {
    this.pruneStore(nowMs);
    // Синхронный вариант дочитывает базу до конца: он для тестов и для
    // процесса, которому некому уступать цикл событий.
    while ((this.pool.backfillStep?.() ?? 0) > 0) {
      /* следующий шаг */
    }
    return this.finishRestore(nowMs);
  }

  /**
   * Async variant that yields to the event loop between backfill steps,
   * keeping HTTP response latency low while a pool written before B221 is
   * being read through once (B218, B221).
   */
  public async restoreAsync(
    nowMs: number = Date.now(),
    // 250 строк — около 0,6 с на VM прода (0,2 мс на строку локально, прод
    // медленнее в ~12 раз): дольше держать цикл событий на старте нельзя.
    chunkSize = 250,
    options: { prune?: boolean } = {},
  ): Promise<{ restored: number }> {
    // A large SQLite pool may need a write-side maintenance pass. Production
    // readiness must not wait for that pass; callers can keep the historical
    // pruning behavior for small/test stores with the default.
    if (options.prune !== false) this.pruneStore(nowMs);
    while ((this.pool.backfillStep?.(chunkSize) ?? 0) > 0) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    return this.finishRestore(nowMs);
  }

  private pruneStore(nowMs: number): void {
    const oldestPublishedAt = new Date(
      nowMs - MAX_VACANCY_AGE_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();
    this.pool.prune(Array.from(this.sources.keys()), oldestPublishedAt);
    this.pruneClusters(oldestPublishedAt);
  }

  private pruneClusters(oldestPublishedAt: string): void {
    if (typeof this.pool.pruneClustersBefore === 'function') {
      this.pool.pruneClustersBefore(oldestPublishedAt);
      // SQLite-backed production reads remain page-sized after a restart. The
      // in-memory snapshot is intentionally empty until an explicit rebuild or
      // point lookup asks for more data.
      this.clusters = [];
      this.clusterBuilder = new IncrementalClusterBuilder([]);
      return;
    }
    if (
      this.clusters.length === 0 &&
      typeof this.pool.countClusters === 'function' &&
      this.pool.countClusters() > 0
    ) {
      this.clusters = typeof this.pool.loadClusters === 'function' ? this.pool.loadClusters() : [];
    }
    const initialLen = this.clusters.length;
    this.clusters = this.clusters.filter((cluster) => {
      if (cluster.lastSeenAt < oldestPublishedAt) {
        if (typeof this.pool.deleteCluster === 'function') {
          this.pool.deleteCluster(cluster.id);
        }
        return false;
      }
      return true;
    });
    if (this.clusters.length !== initialLen || !this.clusterBuilder) {
      this.clusterBuilder = new IncrementalClusterBuilder(this.clusters);
    }
  }

  private finishRestore(nowMs: number): { restored: number } {
    this.restoreSourceStates();
    const persistedClusterCount = this.pool.countClusters();
    if (typeof this.pool.loadClustersPage === 'function') {
      // A disk-backed store already has the durable snapshot. Do not hydrate
      // every cluster just to answer the next public request; that was the
      // production OOM path. Public routes use loadClustersPage instead.
      this.clusters = [];
      this.clusterBuilder = new IncrementalClusterBuilder([]);
      this.poolChangedSinceRecluster = persistedClusterCount === 0;
    } else if (persistedClusterCount > 0) {
      this.clusters = typeof this.pool.loadClusters === 'function' ? this.pool.loadClusters() : [];
      this.clusterBuilder = new IncrementalClusterBuilder(this.clusters);
      this.poolChangedSinceRecluster = false;
    } else {
      this.poolChangedSinceRecluster = true;
    }
    return { restored: this.pool.countVacancies(freshnessWindow(nowMs)) };
  }

  public getSources(): VacancySourceConfig[] {
    return Array.from(this.sources.values());
  }

  public getSource(id: string): VacancySourceConfig | undefined {
    return this.sources.get(id);
  }

  /**
   * Админский маршрут пишет только durable намерение. Сам fetcher вызывается
   * обслуживателем, иначе HTTP-процесс снова начнёт писать пул в режиме off.
   */
  public requestSourceSync(
    sourceId: string,
    requestedAt: string = new Date().toISOString(),
  ): RequestedSourceSync {
    const source = this.sources.get(sourceId);
    if (!source) throw new Error(`Источник вакансий ${sourceId} не найден`);
    if (!source.syncRequestedAt || source.syncRequestedAt < requestedAt) {
      source.syncRequestedAt = requestedAt;
      if (this.pool.requestSourceSync) {
        this.pool.requestSourceSync(sourceId, requestedAt);
      } else {
        this.persistSourceState(source);
      }
    }
    return {
      sourceId,
      requestedAt: source.syncRequestedAt,
      ...(source.syncStartedAt ? { startedAt: source.syncStartedAt } : {}),
    };
  }

  public requestAllSourceSyncs(
    requestedAt: string = new Date().toISOString(),
  ): RequestedSourceSync[] {
    return Array.from(this.sources.values())
      .filter((source) => source.enabled)
      .map((source) => this.requestSourceSync(source.id, requestedAt));
  }

  public getRequestedSourceSyncs(): RequestedSourceSync[] {
    // The HTTP process can enqueue a request after the worker was started.
    // Source state is tiny and bounded by the registry, so refresh it before
    // every worker tick instead of keeping a stale in-memory queue (B231).
    this.restoreSourceStates();
    return Array.from(this.sources.values())
      .filter(
        (source): source is VacancySourceConfig & { syncRequestedAt: string } =>
          typeof source.syncRequestedAt === 'string',
      )
      .map((source) => ({
        sourceId: source.id,
        requestedAt: source.syncRequestedAt,
        ...(source.syncStartedAt ? { startedAt: source.syncStartedAt } : {}),
      }));
  }

  public markSourceSyncStarted(
    request: RequestedSourceSync,
    startedAt = new Date().toISOString(),
  ): boolean {
    const source = this.sources.get(request.sourceId);
    if (!source || source.syncRequestedAt !== request.requestedAt) return false;
    const marked = this.pool.markSourceSyncStarted?.(
      request.sourceId,
      request.requestedAt,
      startedAt,
    );
    if (marked === false) return false;
    source.syncStartedAt = startedAt;
    if (marked === undefined) this.persistSourceState(source);
    return true;
  }

  public clearSourceSyncRequest(request: RequestedSourceSync): boolean {
    const source = this.sources.get(request.sourceId);
    if (!source || source.syncRequestedAt !== request.requestedAt) return false;
    const cleared =
      this.pool.clearSourceSyncRequest?.(request.sourceId, request.requestedAt) ?? false;
    if (!cleared && this.pool.requestSourceSync === undefined) {
      source.syncRequestedAt = undefined;
      source.syncStartedAt = undefined;
      return true;
    }
    if (!cleared) return false;
    source.syncRequestedAt = undefined;
    source.syncStartedAt = undefined;
    return true;
  }

  public getManualSourceSyncState(sourceId: string): ManualSourceSyncState {
    const source = this.sources.get(sourceId);
    if (!source?.syncRequestedAt) return { status: 'ready' };
    return {
      status: source.syncStartedAt ? 'running' : 'queued',
      requestedAt: source.syncRequestedAt,
      ...(source.syncStartedAt ? { startedAt: source.syncStartedAt } : {}),
    };
  }

  /** An account is gone: its campaign target no longer steers the hh text queue. */
  public forgetHhTextRoleTarget(candidateId: string): void {
    this.pool.forgetHhTextRoleTarget?.(candidateId);
  }

  /** Refreshes only the bounded source-state registry; it never hydrates pool rows. */
  public refreshPersistedSourceState(): void {
    this.restoreSourceStates();
  }

  public addOrUpdateSource(source: VacancySourceConfig): void {
    this.sources.set(source.id, { ...source });
    this.rememberRight(source);
    this.configureSourcePoliteness(source);
  }

  /**
   * Право берётся только из реестра B199. Источник, пришедший без него,
   * остаётся fail-closed: «право не установлено» — это не разрешение.
   */
  private rememberRight(source: VacancySourceConfig): void {
    const right = (source as { addressStatus?: SourceAddressRight }).addressStatus;
    if (right) this.rights.set(source.id, right);
  }

  /** Здоровье каждой площадки: живость и доверие считаются раздельно (B200). */
  public getSourceHealth(
    sourceId: string,
    nowMs: number = Date.now(),
  ): SourceHealthReportItem | undefined {
    const source = this.sources.get(sourceId);
    if (!source) return undefined;
    return {
      sourceId: source.id,
      sourceName: source.name,
      ...this.healthOf(source.id, nowMs),
      schedule: this.scheduler.getScheduleInfo(source.id, nowMs, source.refreshIntervalMinutes),
    };
  }

  public getSourceHealthReport(nowMs: number = Date.now()): SourceHealthReportItem[] {
    return Array.from(this.sources.keys()).flatMap((sourceId) => {
      const measured = this.getSourceHealth(sourceId, nowMs);
      return measured ? [measured] : [];
    });
  }

  private healthOf(sourceId: string, nowMs: number): SourceHealth {
    const rawObs = this.observations.get(sourceId) ?? emptySourceObservations();
    // Health is called by the scheduler for every source. A disk-backed pool
    // must not hydrate the complete cluster snapshot just to render a verdict;
    // the observation ledger is the durable signal until an explicit matching
    // or rebuild operation asks for the full in-memory view.
    this.ensureClusters({ hydrateDisk: false });
    const authenticity =
      this.clusters.length > 0
        ? calculateSourceAuthenticity(sourceId, this.clusters)
        : rawObs.authenticity;
    return describeSourceHealth(
      { ...rawObs, authenticity },
      { addressStatus: this.rights.get(sourceId) ?? 'not_established' },
      nowMs,
    );
  }

  private observe(sourceId: string, reading: Parameters<typeof recordReading>[1]): void {
    this.observations.set(
      sourceId,
      recordReading(this.observations.get(sourceId) ?? emptySourceObservations(), reading),
    );
  }

  public toggleSource(sourceId: string, enabled: boolean): VacancySourceConfig {
    const source = this.sources.get(sourceId);
    if (!source) throw new Error(`Источник ${sourceId} не найден`);
    source.enabled = enabled;
    return { ...source };
  }

  public removeSource(id: string): boolean {
    return this.sources.delete(id);
  }

  public getActiveClusters(): VacancyCluster[] {
    this.ensureClusters();
    return this.clusters.filter((c) => c.status === 'active');
  }

  /**
   * Public catalog reads must stay bounded. Hydrating every persisted cluster
   * for an SEO request defeated B221's disk-backed pool and eventually OOMed
   * the production Node process. Internal matching keeps its full path; only
   * public HTML gets this deliberate freshness-bounded page.
   */
  /**
   * Вакансии компании вне подборки (экран компании из «Хочу»): точечное чтение
   * по ключам работодателя, без загрузки всех кластеров в HTTP-путь.
   */
  /** One stored cluster by id (company screen: a wanted company's pool vacancy). */
  public getStoredCluster(clusterId: string): VacancyCluster | undefined {
    return this.pool.getCluster?.(clusterId);
  }

  public getCompanyClusters(companyName: string, limit = 20): VacancyCluster[] {
    return this.pool.loadClustersByCompany?.(companyName, limit) ?? [];
  }

  public getPublicCatalogClusters(limit = 24): VacancyCluster[] {
    if (typeof this.pool.loadClustersPage === 'function') {
      return this.pool.loadClustersPage(limit).filter((cluster) => cluster.status === 'active');
    }
    return this.getActiveClusters().slice(0, limit);
  }

  /**
   * Read the materialized public catalog when its bounded backfill is complete.
   * Memory stores first build their tiny in-process snapshot; SQLite stores do
   * not hydrate any cluster JSON here.
   */
  public getPublicCatalogEntriesPage(query: CatalogEntriesQuery): CatalogEntriesPage | undefined {
    if (typeof this.pool.loadCatalogEntriesPage !== 'function') return undefined;
    if (
      typeof this.pool.catalogProjectionReady === 'function' &&
      !this.pool.catalogProjectionReady()
    ) {
      return undefined;
    }
    if (typeof this.pool.loadClustersPage !== 'function') this.ensureClusters();
    const known = this.knownCatalogTotal(query);
    const page = this.pool.loadCatalogEntriesPage(
      known === undefined ? query : { ...query, knownTotal: known },
    );
    if (!query.place && !query.role && known === undefined) {
      this.rootTotalCache = { at: this.now(), total: page.total };
    }
    return page;
  }

  /**
   * A total without the table scan: listed groups (>= 3) come from the cached
   * summaries, the whole catalog from a TTL copy. Unlisted groups have < 3
   * entries and are counted exactly through an index. Stale by LISTINGS_CACHE_MS.
   */
  private knownCatalogTotal(query: CatalogEntriesQuery): number | undefined {
    if (query.knownTotal !== undefined) return query.knownTotal;
    const now = this.now();
    if (!query.place) {
      if (query.role) return undefined;
      const root = this.rootTotalCache;
      return root && now - root.at < LISTINGS_CACHE_MS ? root.total : undefined;
    }
    const listings = this.getPublicCatalogListings();
    return listings?.find((l) => l.place === query.place && l.role === query.role)?.count;
  }

  /** HTTP (B485): одна строка итогов по ключу; ошибка чтения — сводки нет. */
  public getCatalogTotals(): CatalogTotals | undefined {
    try {
      return this.pool.readCatalogTotals?.();
    } catch {
      return undefined;
    }
  }

  /** Обслуживание (B485): пересчёт итогов после сведения пула. */
  public refreshCatalogTotals(
    observedAt: string,
  ): CatalogTotals | undefined | Promise<CatalogTotals> {
    if (typeof this.pool.recomputeCatalogTotalsInSlices === 'function') {
      return this.pool.recomputeCatalogTotalsInSlices(observedAt);
    }
    return this.pool.recomputeCatalogTotals?.(observedAt);
  }

  public getPublicCatalogListings(): CatalogListingSummary[] | undefined {
    if (typeof this.pool.loadCatalogListings !== 'function') return undefined;
    if (
      typeof this.pool.catalogProjectionReady === 'function' &&
      !this.pool.catalogProjectionReady()
    ) {
      return undefined;
    }
    if (typeof this.pool.loadClustersPage !== 'function') this.ensureClusters();
    // The GROUP BY over the whole projection took ~1.8 s on prod and ran on
    // the event loop for every listing page; counts move only with
    // maintenance, so a short-lived copy is enough (B535).
    const now = this.now();
    if (this.listingsCache && now - this.listingsCache.at < LISTINGS_CACHE_MS) {
      return this.listingsCache.value;
    }
    const value = this.pool.loadCatalogListings();
    this.listingsCache = { at: now, value };
    return value;
  }

  /** B569: one row by primary key; maintenance computes it, the request never scans. */
  public getPublicCatalogSalaryStats(query: {
    place: string;
    role?: string;
  }): SalaryStats | undefined {
    return this.pool.getCatalogSalaryStats?.(query);
  }

  /** B574: chip counts of one list; maintenance writes them, the request reads one row. */
  public getPublicCatalogChipCounts(listKey: string): ChipCounts {
    if (typeof this.pool.getCatalogChipCounts !== 'function') return {};
    if (typeof this.pool.loadClustersPage !== 'function') this.ensureClusters();
    return this.pool.getCatalogChipCounts(listKey);
  }

  /** B574: one page of a chip list; undefined while the projection is not ready. */
  public getPublicCatalogChipPage(query: CatalogChipQuery): CatalogEntriesPage | undefined {
    if (typeof this.pool.loadCatalogChipPage !== 'function') return undefined;
    if (
      typeof this.pool.catalogProjectionReady === 'function' &&
      !this.pool.catalogProjectionReady()
    ) {
      return undefined;
    }
    if (typeof this.pool.loadClustersPage !== 'function') this.ensureClusters();
    return this.pool.loadCatalogChipPage(query);
  }

  public getPublicCatalogEntry(key: string): CatalogEntryRow | undefined {
    if (typeof this.pool.getCatalogEntry !== 'function') return undefined;
    if (
      typeof this.pool.catalogProjectionReady === 'function' &&
      !this.pool.catalogProjectionReady()
    ) {
      return undefined;
    }
    if (typeof this.pool.loadClustersPage !== 'function') this.ensureClusters();
    return this.pool.getCatalogEntry(key);
  }

  public getPublicCatalogCluster(clusterId: string): VacancyCluster | undefined {
    if (typeof this.pool.getCluster === 'function') return this.pool.getCluster(clusterId);
    this.ensureClusters();
    return this.clusters.find((cluster) => cluster.id === clusterId);
  }

  /**
   * Один активный кластер по идентификатору для действий над одной вакансией
   * (отклик, контакты). `getActiveClusters().find(...)` на проде поднимал все
   * кластеры с диска и держал цикл событий минуты — сервер переставал
   * отвечать после одного нажатия (PRB-041).
   */
  public getActiveCluster(clusterId: string): VacancyCluster | undefined {
    const cluster = this.resolveClusterForId(clusterId);
    return cluster?.status === 'active' ? cluster : undefined;
  }

  /**
   * B550: активный кластер каталога по ключу участника (URL вакансии) — один
   * индексированный запрос к `vacancy_cluster_keys`, без подъёма пула.
   */
  public getActiveClusterByMemberKey(key: string): VacancyCluster | undefined {
    if (!key || typeof this.pool.clusterIdForMemberKey !== 'function') return undefined;
    const clusterId = this.pool.clusterIdForMemberKey(key);
    const cluster = clusterId ? this.getPublicCatalogCluster(clusterId) : undefined;
    return cluster?.status === 'active' ? cluster : undefined;
  }

  /**
   * True когда `clusterId` был известной вакансией — нашлась запись
   * (возможно, снятая) или прямое совпадение кластера, — но живого активного
   * кластера для неё сейчас нет: снята или заменилась при пересборке. Клик
   * должен получить 410 с понятной причиной, а не молчаливый 404 (B247 S5).
   */
  public isKnownVacancyGone(clusterId: string): boolean {
    if (this.getActiveCluster(clusterId)) return false;
    const inHeap = this.clusters.find((cluster) => cluster.id === clusterId);
    const direct = inHeap ?? this.getPublicCatalogCluster(clusterId);
    if (direct) return true;
    return this.memberRecordExists(clusterId);
  }

  private memberRecordExists(clusterId: string): boolean {
    const prefix = 'cluster-';
    if (!clusterId.startsWith(prefix)) return false;
    const memberId = clusterId.slice(prefix.length);
    if (!memberId) return false;
    const member = this.pool.getVacancyIncludingExpired
      ? this.pool.getVacancyIncludingExpired(memberId)
      : this.pool.getVacancy(memberId);
    return member !== undefined;
  }

  /**
   * Строка подбора получает id `cluster-<первая запись>` кластера, собранного
   * **на запросе** (`vacancyDeduplicator.ts` вокруг строки 204), а сохранённый
   * кластер может быть склеен вокруг другого основателя — прямое совпадение id
   * находит только первого члена (B247 S5). Промах по id → id записи из
   * `cluster-<id>` → её `externalId`/`sourceUrl` → ключ `member` в
   * `vacancy_cluster_keys` (точечный индексный запрос, не полный пул).
   */
  private resolveClusterForId(clusterId: string): VacancyCluster | undefined {
    const inHeap = this.clusters.find((cluster) => cluster.id === clusterId);
    const direct = inHeap ?? this.getPublicCatalogCluster(clusterId);
    if (direct) return direct;
    return this.resolveClusterByMember(clusterId);
  }

  private resolveClusterByMember(clusterId: string): VacancyCluster | undefined {
    const prefix = 'cluster-';
    if (!clusterId.startsWith(prefix)) return undefined;
    const memberId = clusterId.slice(prefix.length);
    if (!memberId) return undefined;
    const member = this.pool.getVacancyIncludingExpired
      ? this.pool.getVacancyIncludingExpired(memberId)
      : this.pool.getVacancy(memberId);
    if (!member) return undefined;
    if (typeof this.pool.clusterIdForMemberKey !== 'function') return undefined;
    for (const key of memberKeysOf(member)) {
      const savedClusterId = this.pool.clusterIdForMemberKey(key);
      if (!savedClusterId) continue;
      const saved = this.getPublicCatalogCluster(savedClusterId);
      if (saved) return saved;
    }
    return undefined;
  }

  /** One event-loop-sized materialization tick for B229. */
  /**
   * Один шаг заполнения `vacancy_cluster_keys` по кластерам, записанным до
   * B230; ноль — заполнять нечего. Хранилище без ключей — сразу готово.
   */
  public runClusterKeysBackfillStep(chunk?: number): number {
    return this.pool.backfillClusterKeysStep?.(chunk) ?? 0;
  }

  public get clusterKeysReady(): boolean {
    return this.pool.clusterKeysReady?.() ?? true;
  }

  public runCatalogMaintenanceStep(
    chunk?: number,
  ): { processed: number; pending: number } | undefined {
    if (typeof this.pool.backfillCatalogEntriesStep !== 'function') return undefined;
    const processed = this.pool.backfillCatalogEntriesStep(chunk);
    return {
      processed,
      pending: processed === 0 ? 0 : (this.pool.pendingCatalogEntries?.() ?? 0),
    };
  }

  /**
   * Один шаг обогащения вакансий пула управленческими навыками (B307).
   */
  public runDescriptionSkillsStep(chunk?: number): {
    inspected: number;
    updated: number;
    passFinished: boolean;
  } {
    return (
      this.pool.backfillDescriptionSkillsStep?.(chunk) ?? {
        inspected: 0,
        updated: 0,
        passFinished: true,
      }
    );
  }

  /** Один шаг очистки кластеров и карточек каталога без записей пула (B535). */
  public runOrphanClusterStep(chunk?: number): {
    inspected: number;
    removed: number;
    passFinished: boolean;
  } {
    return (
      this.pool.removeOrphanClustersStep?.(chunk) ?? {
        inspected: 0,
        removed: 0,
        passFinished: true,
      }
    );
  }

  /**
   * Один такт фонового дочитывания текста hh для каталога (B535): тем же
   * загрузчиком, что карточка кабинета, без обхода в HTTP-процессе.
   */
  public runHhCatalogTextStep(): Promise<HhCatalogTextReport> {
    const pool = this.pool;
    this.hhCatalogText ??= new HhCatalogTextBackfill({
      perTick: () => this.rate()?.portionFor(HH_TEXT_TICK_MS) ?? HH_TEXT_PER_TICK,
      concurrency: () => this.rate()?.maxInFlight() ?? HH_TEXT_CONCURRENCY,
      engine: {
        hhTextReady: () => {
          const source = this.sources.get(HH_SEARCH_SOURCE_ID);
          return (
            Boolean(this.descriptionLoader) &&
            typeof pool.loadHhTextCandidates === 'function' &&
            Boolean(source?.enabled) &&
            this.rights.get(HH_SEARCH_SOURCE_ID) === 'live'
          );
        },
        // 04.11: rows of candidates' roles have their own position, first on every tick.
        loadRoleCandidates: (limit) => {
          const position = pool.loadHhRoleTextPosition?.();
          return (
            pool.loadHhRoleTextCandidates?.(position, limit) ?? {
              ids: [],
              position: position ?? '',
            }
          );
        },
        saveRolePosition: (position) => pool.saveHhRoleTextPosition?.(position),
        loadHhTextCandidates: (cursor, limit) => pool.loadHhTextCandidates!(cursor, limit),
        loadSavedCursor: () => pool.loadHhTextCursor?.(),
        saveCursor: (cursor) => pool.saveHhTextCursor?.(cursor),
        peekPriority: (limit) => pool.peekHhTextPriority?.(limit) ?? [],
        dropPriority: (ids) => pool.dropHhTextPriority?.(ids),
        loadVacancyDescription: (id) => this.loadVacancyDescription(id),
      },
    });
    // 03.11: тик текста идёт каждые 3 с; побочные шаги сведения не чаще раза в 12 с, как раньше.
    const nowMs = Date.now();
    const sideStepDue = nowMs - this.lastHhSideStepAt >= 12_000;
    if (sideStepDue) this.lastHhSideStepAt = nowMs;
    // B641: побочные шаги и чтение текста — в разных оборотах цикла событий.
    const backfill = this.hhCatalogText;
    return yieldTurn()
      .then(() => (sideStepDue ? this.runHhSideSteps() : undefined))
      .then(() => yieldTurn())
      .then(() => backfill.step())
      .then((report) => {
        const rateWindow = this.rate()?.takeClosedWindow();
        return rateWindow ? { ...report, rateWindow } : report;
      });
  }

  /** Сведение дочитанных текстов и снятие кластеров снятых строк — каждое в своём обороте. */
  private async runHhSideSteps(): Promise<void> {
    this.runClusterTextStep();
    await yieldTurn();
    this.pool.archiveExpiredHhClusters?.(EXPIRED_CLUSTER_BATCH);
  }

  private rate(): HhTextRateController | undefined {
    return this.descriptionLoader?.rateControl?.();
  }

  /**
   * Сводит записи, у которых дочитан полный текст, с двойниками по тексту
   * (01.11): одна партия соседей по ключам, без чтения всех кластеров. Только
   * в режиме `keyed` — это процесс обслуживания.
   */
  public runClusterTextStep(limit = 200): number {
    if (this.reclusterMode.mode !== 'keyed' || !this.pool.nextClusterTextBatch) return 0;
    const batch = this.pool.nextClusterTextBatch(limit);
    if (batch.length === 0) return 0;
    clusterBatchByKeys(this.keyedStore(), batch.map(clusterProjectionOf));
    return batch.length;
  }

  /**
   * Один такт дочитывания текста вакансий Workday (B535): только включённые
   * площадки с подтверждённым правом. Зовёт только воркер обслуживания.
   */
  public runWorkdayDescriptionStep(): Promise<WorkdayDescriptionReport> {
    const pool = this.pool;
    if (typeof pool.loadVacanciesWithoutFullText !== 'function') {
      return Promise.resolve({ requested: 0, loaded: 0, gone: 0, failed: 0, throttled: 0 });
    }
    this.workdayDescriptions ??= new WorkdayDescriptionBackfill({
      pool: {
        loadVacanciesWithoutFullText: (sourceId, limit, excludeIds) =>
          pool.loadVacanciesWithoutFullText!(sourceId, limit, excludeIds),
        mergeSourceSlice: (sourceId, vacancies) => pool.mergeSourceSlice(sourceId, vacancies),
        markExpired: (ids, atIso) => pool.markExpired(ids, atIso),
      },
      sourceIds: () =>
        [...this.sources.values()]
          .filter((source) => source.enabled && this.rights.get(source.id) === 'live')
          .map((source) => source.id),
      // Такт воркера — 10 с; источник без своего темпа спрашивается раз в 20 с.
      defaultIntervalMs: 20_000,
      ...(this.workdayDetailFetch ? { fetchDetail: this.workdayDetailFetch } : {}),
    });
    return this.workdayDescriptions.step();
  }

  /**
   * Собирает кластеры, если пул менялся с прошлой сборки — только в режиме
   * `sync`. В фоновом режиме чтение отдаёт то, что есть: одно «медленное
   * чтение» на проде — это минуты без ответа для всех (B221).
   */
  private ensureClusters(options: { hydrateDisk?: boolean } = {}): void {
    // B641 10.11: без этой проверки здоровье каждого источника считало все кластеры
    // (20 мс тёплым) — 52 с синхронно на волну из ~2 500 источников. Вне режима `sync`
    // итог тот же: ветка ниже ничего не делает.
    if (
      options.hydrateDisk === false &&
      this.clusters.length === 0 &&
      this.reclusterMode.mode !== 'sync' &&
      typeof this.pool.loadClustersPage === 'function'
    ) {
      return;
    }
    if (
      this.clusters.length === 0 &&
      typeof this.pool.countClusters === 'function' &&
      this.pool.countClusters() > 0
    ) {
      if (options.hydrateDisk === false && typeof this.pool.loadClustersPage === 'function') {
        return;
      }
      this.clusters = typeof this.pool.loadClusters === 'function' ? this.pool.loadClusters() : [];
      this.clusterBuilder = new IncrementalClusterBuilder(this.clusters);
      this.poolChangedSinceRecluster = false;
      return;
    }
    if (this.reclusterMode.mode !== 'sync') return;
    if (this.poolChangedSinceRecluster) this.recluster();
  }

  /**
   * Одна запись целиком: список отдаётся кратким видом внутри байтового бюджета
   * маршрута (INC-032), а полный текст поста читает карточка.
   */
  /** Сколько свежих записей в пуле — счёт по хранилищу, не по куче (B220, B221). */
  public get poolSize(): number {
    return this.pool.countVacancies(freshnessWindow());
  }

  public getVacancy(id: string): UnifiedVacancy | undefined {
    return this.pool.getVacancy(id);
  }

  /**
   * Дочитывает одну hh-карточку по явному действию кандидата и кладёт текст в
   * ту же запись пула. Никакого фонового обхода: один id — один запрос.
   */
  public loadVacancyDescription(id: string): Promise<VacancyDescriptionLoadResult> {
    const existing = this.pool.getVacancy(id);
    if (!existing || existing.provenance.sourceId !== 'src-hh-search' || !this.descriptionLoader) {
      return Promise.resolve({
        ...(existing ? { vacancy: existing } : {}),
        unavailable: false,
        status: 'skipped',
      });
    }
    const source = this.sources.get(existing.provenance.sourceId);
    if (!source?.enabled || this.rights.get(source.id) !== 'live') {
      return Promise.resolve({ vacancy: existing, unavailable: false, status: 'skipped' });
    }
    if (
      this.persistedDescriptionIds.has(id) ||
      // 01.11: дочитанный текст без навыков — тоже готов; иначе он запрашивался каждый раз.
      existing.fullDescription?.trim()
    ) {
      return Promise.resolve({ vacancy: existing, unavailable: false, status: 'cached' });
    }
    if (existing.descriptionHidden) {
      return Promise.resolve({
        vacancy: existing,
        unavailable: true,
        status: 'skipped',
        restricted: true,
      });
    }
    const pending = this.descriptionLoads.get(id);
    if (pending) return pending;
    const load = this.loadAndStoreVacancyDescription(existing);
    this.descriptionLoads.set(id, load);
    void load.finally(() => this.descriptionLoads.delete(id));
    return load;
  }

  /**
   * 01.11: строки подборки в голову очереди текста hh воркера обслуживания; сеть здесь
   * не трогается. Ошибку записи видит вызывающий.
   */
  public requestHhTextPriority(ids: readonly string[], baseRank = 0): void {
    this.pool.requestHhTextPriority?.(ids, baseRank);
  }

  /** Первые карточки подбора греются последовательно, не создавая веер запросов. */
  public async preloadVacancyDescriptions(
    ids: readonly string[],
    limit = 20,
  ): Promise<VacancyDescriptionPreloadSummary> {
    const selected = Array.from(new Set(ids)).slice(0, limit);
    const counts = { loaded: 0, skipped: 0, failed: 0 };
    for (let index = 0; index < selected.length; index += 1) {
      const id = selected[index]!;
      const result = await this.loadVacancyDescription(id);
      if (result.status === 'loaded') counts.loaded += 1;
      else if (result.status === 'failed') {
        counts.failed += 1;
        // 28.10: one unreadable page used to stop every later warm-up for good; only a refusal
        // or backoff from the platform stops the batch.
        if (!result.blocked) continue;
        counts.skipped += selected.length - index - 1;
        break;
      } else counts.skipped += 1;
    }
    return { requested: selected.length, ...counts };
  }

  /**
   * Работодатель снял вакансию на площадке: запись уходит из выдачи так же, как
   * после проверки живости ссылки (B200). Это не отказ площадки — пакет
   * дочитывания идёт дальше (B304).
   */
  private retireArchivedVacancy(vacancy: UnifiedVacancy): VacancyDescriptionLoadResult {
    // Только индекс: handleExpiredVacancies грузит все кластеры и в HTTP-процессе
    // выбивал память (heap OOM на проде 29.09). Кластер сведёт воркер обслуживания.
    this.pool.markExpired([vacancy.id], new Date().toISOString());
    return { vacancy, unavailable: true, status: 'skipped' };
  }

  /**
   * 02.11: hh answered «работодатель ограничил доступ». The first answer may be a passing state
   * and is retried after the backfill's delay; the second marks the text hidden for good.
   */
  private noteHiddenText(vacancy: UnifiedVacancy): VacancyDescriptionLoadResult {
    const seen = (vacancy.descriptionHiddenSeen ?? 0) + 1;
    const hidden = seen >= HIDDEN_TEXT_ANSWERS;
    const updated: UnifiedVacancy = {
      ...vacancy,
      descriptionHiddenSeen: seen,
      ...(hidden ? { descriptionHidden: true } : {}),
    };
    try {
      this.pool.mergeSourceSlice(vacancy.provenance.sourceId, [updated]);
    } catch {
      return { vacancy, unavailable: true, status: 'failed' };
    }
    return hidden
      ? { vacancy: updated, unavailable: true, status: 'skipped', restricted: true }
      : { vacancy: updated, unavailable: true, status: 'failed', restricted: true };
  }

  private async loadAndStoreVacancyDescription(
    vacancy: UnifiedVacancy,
  ): Promise<VacancyDescriptionLoadResult> {
    let loaded: VacancyDescriptionLoaded | string | undefined;
    try {
      loaded = await this.descriptionLoader!.load(vacancy.url);
    } catch {
      return { vacancy, unavailable: true, status: 'failed' };
    }
    if (!loaded) return { vacancy, unavailable: true, status: 'failed' };
    if (typeof loaded === 'object' && loaded.blocked) {
      return { vacancy, unavailable: true, status: 'failed', blocked: loaded.blocked };
    }
    if (typeof loaded === 'object' && loaded.archived) return this.retireArchivedVacancy(vacancy);
    if (typeof loaded === 'object' && loaded.restricted) return this.noteHiddenText(vacancy);

    const fullDescription = typeof loaded === 'string' ? loaded : loaded.description;
    const loadedSkills =
      typeof loaded === 'object' && Array.isArray(loaded.skills) ? loaded.skills : [];
    if (!fullDescription && loadedSkills.length === 0) {
      return { vacancy, unavailable: true, status: 'failed' };
    }

    const existingSkills = vacancy.requiredSkills ?? [];
    // Работодатели на hh часто не заполняют «Ключевые навыки»: тогда требования
    // берутся из текста описания тем же словарём, что у ленты Telegram (B304).
    const pageSkills =
      loadedSkills.length > 0 ? [...loadedSkills] : extractSkillsFromText(fullDescription ?? '');
    const skillsToSave = existingSkills.length > 0 ? existingSkills : pageSkills;

    const updated: UnifiedVacancy = {
      ...vacancy,
      ...(fullDescription ? { fullDescription } : {}),
      requiredSkills: skillsToSave,
    };
    try {
      this.pool.mergeSourceSlice(vacancy.provenance.sourceId, [updated]);
    } catch {
      return { vacancy, unavailable: true, status: 'failed' };
    }
    this.persistedDescriptionIds.delete(vacancy.id);
    this.persistedDescriptionIds.add(vacancy.id);
    if (this.persistedDescriptionIds.size > MAX_PERSISTED_DESCRIPTION_IDS) {
      const oldest = this.persistedDescriptionIds.values().next();
      if (!oldest.done) this.persistedDescriptionIds.delete(oldest.value);
    }
    return { vacancy: updated, unavailable: false, status: 'loaded' };
  }

  /** Есть ли запись в пуле — по индексу, без чтения текста (быстрый проход hh, B219). */
  public hasVacancy(id: string): boolean {
    return this.pool.hasVacancy(id);
  }

  /** Свежие записи обхода hh по подстроке (29.10); хранилище без такого чтения даёт пустой срез. */
  public async storedHhSample(text: string, limit: number): Promise<UnifiedVacancy[]> {
    return (await this.pool.queryStoredHhSampleAsync?.(text, limit)) ?? [];
  }

  public getVacancies(filter: VacancyQueryFilter = {}): VacancyQueryResult {
    const window = freshnessWindow();
    const counts = this.pool.countBySource(window);
    const statsBySource = Array.from(this.sources.values()).map((s) => ({
      sourceId: s.id,
      sourceName: s.name,
      count: counts.get(s.id) ?? 0,
    }));

    // Тип площадки хранилище не знает — это свойство реестра, а не записи.
    // Фильтр по типу переводится в список площадок этого типа.
    let sourceIds: string[] | undefined;
    if (filter.type !== undefined) {
      sourceIds = Array.from(this.sources.values())
        .filter((s) => s.type === filter.type)
        .map((s) => s.id);
    }
    if (filter.sourceId !== undefined) {
      sourceIds = (sourceIds ?? [filter.sourceId]).filter((id) => id === filter.sourceId);
    }

    const page = this.pool.queryVacancies({
      window,
      ...(sourceIds === undefined ? {} : { sourceIds }),
      ...(filter.isRemote === undefined ? {} : { isRemote: filter.isRemote }),
      ...(filter.query === undefined ? {} : { query: filter.query }),
      offset: filter.offset ?? 0,
      limit: filter.limit ?? 20,
    });

    return { total: page.total, items: page.items, statsBySource };
  }

  /**
   * Compares persisted source ownership with the bounded registry without
   * loading vacancy payloads. This is the B235 orphan audit and is intentionally
   * a summary, so an admin request cannot dump the production pool.
   */
  public auditSourceOwnership(): SourceOwnershipAudit {
    const counts = this.pool.countAllSourceSlices?.() ?? new Map();
    let totalStoredRows = 0;
    let activeRows = 0;
    let registeredSourcesWithRows = 0;
    const orphaned: Array<{ sourceId: string; total: number; active: number }> = [];
    for (const [sourceId, count] of counts) {
      totalStoredRows += count.total;
      activeRows += count.active;
      if (this.sources.has(sourceId)) {
        if (count.active > 0) registeredSourcesWithRows += 1;
      } else {
        orphaned.push({ sourceId, total: count.total, active: count.active });
      }
    }
    orphaned.sort((left, right) => left.sourceId.localeCompare(right.sourceId));
    return { totalStoredRows, activeRows, registeredSourcesWithRows, orphaned };
  }

  public async syncSource(
    sourceId: string,
    query?: string,
    nowMs: number = Date.now(),
  ): Promise<SourceSyncOutcome> {
    if (forbidsDirectSourceSync(this.reclusterMode)) {
      throw new ReclusterDisabledError('source sync is owned by the maintenance process');
    }
    const started = this.syncOne(sourceId, query, nowMs).then((outcome) => {
      // Одиночный опрос сам оставляет пул пересобранным: волна делает это один
      // раз за всю партию (прод 2026-09-06).
      this.reclusterIfChanged();
      return outcome;
    });
    return started;
  }

  /** Один опрос без пересборки пула — шаг волны. */
  private syncOne(
    sourceId: string,
    query: string | undefined,
    nowMs: number,
  ): Promise<SourceSyncOutcome> {
    const inFlight = this.running.get(sourceId);
    if (inFlight) return inFlight;
    const started = this.runSync(sourceId, query, nowMs).finally(() => {
      this.running.delete(sourceId);
    });
    this.running.set(sourceId, started);
    return started;
  }

  /** Один успешный опрос: улов, перепись и запись в пул. */
  private async readSource(
    source: VacancySourceConfig,
    query: string | undefined,
    nowMs: number,
  ): Promise<SourceSyncOutcome> {
    const reading = await this.fetcher!(source, query ? { query } : undefined);
    const fetched: UnifiedVacancy[] = Array.isArray(reading) ? reading : reading.vacancies;
    const partial = Array.isArray(reading) ? false : reading.partial;
    const dropObservedBefore = Array.isArray(reading) ? undefined : reading.dropObservedBefore;

    // Перепись улова считается по тому, что площадка отдала, — до фильтра
    // свежести. Пул хранит только 30 дней, поэтому по нему доля «свежее 180
    // дней» всегда была бы 100 %: тавтология вместо меры (B200).
    this.observe(source.id, {
      succeeded: true,
      census: censusOfReading(fetched, nowMs),
      atMs: nowMs,
    });

    const newItemsCount = fetched.filter((v) => !this.pool.hasVacancy(v.id)).length;
    this.scheduler.recordAttempt(source.id, {
      success: true,
      statusCode: 200,
      newItemsCount,
      nowMs,
    });

    const { kept, replaceRefused } = await this.acceptReading(
      source,
      fetched,
      nowMs,
      partial,
      dropObservedBefore,
    );
    return {
      sourceId: source.id,
      status: 'healthy',
      fetched: fetched.length,
      kept,
      ...(replaceRefused ? { replaceRefused } : {}),
    };
  }

  private async runSync(
    sourceId: string,
    query: string | undefined,
    nowMs: number,
  ): Promise<SourceSyncOutcome> {
    const source = this.sources.get(sourceId);
    if (!source) return { sourceId, status: 'unknown_source', fetched: 0, kept: 0 };
    if (!source.enabled) return { sourceId, status: 'disabled', fetched: 0, kept: 0 };
    // An endpoint that answers nothing usable without a search term must be
    // skipped rather than recorded as an empty success (B164).
    if (source.requiresQuery && !query?.trim()) {
      return { sourceId, status: 'skipped_needs_query', fetched: 0, kept: 0 };
    }

    try {
      // No transport means the source was never contacted. Reporting that as a
      // healthy empty result would be a measurement we never took (B161).
      if (!this.fetcher) {
        throw new Error('vacancy_source_transport_unavailable');
      }
      const permission = await this.robotsPermission(source, nowMs);
      if (permission.disallowed) {
        // Запрет словами — не поломка: площадка сказала «не ходи», и продукт
        // не ходит. Красным отказом это выглядеть не должно (B204).
        return { sourceId, status: 'disabled', fetched: 0, kept: 0, message: permission.reason };
      }
      return await this.readSource(source, query, nowMs);
    } catch (err) {
      const message = failureMessage(err);
      if (message.startsWith('source_not_configured')) {
        // The tool this source needs is not installed here: say so once, do not
        // log an error or a failed reading on every poll.
        source.lastSyncAt = new Date(nowMs).toISOString();
        source.lastStatus = 'degraded';
        source.lastErrorMessage = message;
        this.persistSourceState(source);
        return { sourceId, status: 'disabled', fetched: 0, kept: 0, message };
      }
      // Провал транспорта — не пустой улов: про содержимое площадки он не
      // говорит ничего, поэтому серию пустых уловов он не удлиняет (B200).
      const { statusCode, retryAfterHeader } = extractErrorHttpDetails(err);
      this.observe(source.id, { succeeded: false, atMs: nowMs, notFound: statusCode === 404 });
      source.lastSyncAt = new Date(nowMs).toISOString();
      source.lastStatus = 'error';
      source.lastErrorMessage = message;
      const boardClosed = await this.withdrawClosedBoard(source);
      this.scheduler.recordAttempt(source.id, {
        success: false,
        statusCode,
        retryAfterHeader,
        nowMs,
      });

      this.persistSourceState(source);
      // A failed reading is not evidence that the source went empty, so the
      // slice it delivered last time stays until a successful run replaces it.
      return { sourceId, status: 'error', fetched: 0, kept: 0, message: boardClosed ?? message };
    }
  }

  /**
   * An employer ATS board that answers 404 on several polls in a row is closed,
   * not temporarily down: its vacancies are withdrawn instead of staying
   * matchable for thirty days. One or two 404s change nothing, and only boards
   * the registry knows by provider are treated this way (03.11: greenhouse
   * amplitude/postman/outschool/wayve, recruitee google/olx/samsung).
   */
  private async withdrawClosedBoard(source: VacancySourceConfig): Promise<string | undefined> {
    const count = this.observations.get(source.id)?.consecutiveNotFound ?? 0;
    if (count < BOARD_CLOSED_AFTER_NOT_FOUND || !parseAtsBoardSourceId(source.id)) {
      return undefined;
    }
    if (this.pool.replaceSourceSliceAsync) {
      await this.pool.replaceSourceSliceAsync(source.id, []);
    } else {
      this.pool.replaceSourceSlice(source.id, []);
    }
    this.requiresFullRecluster = true;
    source.itemsActiveTotal = 0;
    source.itemsFoundTotal = 0;
    source.lastErrorMessage = `board_closed: ${count} consecutive 404`;
    this.persistSourceState(source);
    return source.lastErrorMessage;
  }

  /**
   * Принимает удачный улов: свежая часть заменяет прежний срез площадки, и
   * состояние источника переписывается по этому же чтению. Возвращает, сколько
   * записей пул оставил.
   */
  private async acceptReading(
    source: VacancySourceConfig,
    fetched: readonly UnifiedVacancy[],
    nowMs: number,
    readingPartial = false,
    dropObservedBefore?: string,
  ): Promise<{ kept: number; replaceRefused?: ReplaceRefusal }> {
    // Название площадки едет вместе с записью: на экране кандидат читает
    // источник, а не тип адаптера (PRB-017).
    const freshFetched = fetched
      .filter((v) => isVacancyFresh(v.publishedAt))
      .map((v) =>
        v.provenance ? { ...v, provenance: { ...v.provenance, sourceName: source.name } } : v,
      );
    const replaceRefused = this.replaceRefusal(source.id, freshFetched.length, readingPartial);
    const partial = readingPartial || replaceRefused !== undefined;
    const changedExistingMembership =
      partial && hasChangedExistingMembership(this.pool, freshFetched);

    // A successful sync replaces this source's slice. Merging instead meant a
    // vacancy the employer took down an hour after one reading stayed
    // matchable — and openable — for thirty days (B161 review §1).
    //
    // Частичное чтение — исключение, и только оно: источник показал часть
    // выдачи и про остальное ничего не сказал, поэтому «нет в улове» здесь не
    // значит «снято». Срез дополняется, а устаревшее убирает тридцатидневная
    // уборка и проверка живости ссылок (B214).
    if (this.reclusterMode.mode === 'keyed') {
      await this.acceptReadingKeyed(source, freshFetched, partial, dropObservedBefore);
    } else if (partial) {
      if (this.pool.mergeSourceSliceAsync) {
        await this.pool.mergeSourceSliceAsync(source.id, freshFetched, dropObservedBefore);
      } else {
        this.pool.mergeSourceSlice(source.id, freshFetched, dropObservedBefore);
      }
    } else {
      if (this.pool.replaceSourceSliceAsync) {
        await this.pool.replaceSourceSliceAsync(source.id, freshFetched);
      } else {
        this.pool.replaceSourceSlice(source.id, freshFetched);
      }
      this.requiresFullRecluster = true;
    }
    if (this.reclusterMode.mode !== 'keyed') {
      if (dropObservedBefore) this.requiresFullRecluster = true;
      if (changedExistingMembership) this.requiresFullRecluster = true;
    }
    const slice = this.pool.countSourceSlice(source.id);

    // The clock of the run, so the next due check measures the same instant
    // the scheduler used rather than drifting against wall time.
    source.lastSyncAt = new Date(nowMs).toISOString();
    source.lastStatus = 'healthy';
    source.lastErrorMessage = undefined;
    // Счётчик называет размер среза, а не размер одного чтения: после
    // частичного прохода «найдено 1 464» при 36 376 в пуле было бы неправдой.
    source.itemsFoundTotal = slice.total;
    source.itemsActiveTotal = slice.active;
    this.persistSourceState(source);

    // В режимах `off` и `keyed` очередь на сведение не копится: `off` её не
    // разберёт, `keyed` уже свёл партию, а на проде за сутки волн она
    // перевесила бы кучу обслуживателя (B230).
    if (freshFetched.length > 0 && !forbidsFullRecluster(this.reclusterMode)) {
      this.pendingVacancies.push(...freshFetched);
    }
    this.poolChangedSinceRecluster = true;
    return { kept: freshFetched.length, ...(replaceRefused ? { replaceRefused } : {}) };
  }

  private replaceRefusal(
    sourceId: string,
    fetched: number,
    readingPartial: boolean,
  ): ReplaceRefusal | undefined {
    if (readingPartial) return undefined;
    const existing = this.pool.countSourceSlice(sourceId).total;
    return refusesSliceReplace(existing, fetched) ? { existing, fetched } : undefined;
  }

  /**
   * Приём улова в режиме `keyed` (B230): срез пишется как обычно, ушедшие
   * записи снимаются с кластеров точечно, новые сводятся партиями с соседями
   * по ключам. В куче — партия и её соседи, а не пул.
   */
  private async acceptReadingKeyed(
    source: VacancySourceConfig,
    freshFetched: readonly UnifiedVacancy[],
    partial: boolean,
    dropObservedBefore?: string,
  ): Promise<void> {
    const store = this.keyedStore();
    let gone: readonly VacancyLink[];
    if (partial) {
      const result = this.pool.mergeSourceSliceAsync
        ? await this.pool.mergeSourceSliceAsync(source.id, freshFetched, dropObservedBefore)
        : this.pool.mergeSourceSlice(source.id, freshFetched, dropObservedBefore);
      gone = result.dropped;
    } else {
      const fetchedIds = new Set(freshFetched.map((vacancy) => vacancy.id));
      gone = this.pool.loadSourceLinks(source.id).filter((link) => !fetchedIds.has(link.id));
      if (this.pool.replaceSourceSliceAsync) {
        await this.pool.replaceSourceSliceAsync(source.id, freshFetched);
      } else {
        this.pool.replaceSourceSlice(source.id, freshFetched);
      }
    }
    if (gone.length > 0) detachVacanciesByKeys(store, gone);
    const batchSize =
      this.reclusterMode.mode === 'keyed' ? this.reclusterMode.batchSize : DEFAULT_KEYED_BATCH_SIZE;
    for (let offset = 0; offset < freshFetched.length; offset += batchSize) {
      if (offset > 0) await new Promise<void>((resolve) => setImmediate(resolve));
      clusterBatchByKeys(store, freshFetched.slice(offset, offset + batchSize));
    }
    this.keyedClusterings += 1;
  }

  private keyedStore(): KeyedClusterStore {
    const pool = this.pool;
    const loadClustersByKeys = pool.loadClustersByKeys?.bind(pool);
    const loadClusterRepresentatives = pool.loadClusterRepresentatives?.bind(pool);
    const getCluster = pool.getCluster?.bind(pool);
    if (!loadClustersByKeys || !loadClusterRepresentatives || !getCluster) {
      throw new Error('recluster mode keyed needs a store with vacancy_cluster_keys');
    }
    return {
      loadClustersByKeys,
      loadClusterRepresentatives,
      getCluster,
      saveClusters: (clusters) => pool.saveClusters(clusters),
      mergeClusters: (merges) => pool.mergeClusters(merges),
      deleteCluster: (id) => pool.deleteCluster(id),
    };
  }

  private ensureLoadedClusters(): void {
    if (
      this.clusters.length === 0 &&
      typeof this.pool.countClusters === 'function' &&
      this.pool.countClusters() > 0
    ) {
      this.clusters = typeof this.pool.loadClusters === 'function' ? this.pool.loadClusters() : [];
      this.clusterBuilder = new IncrementalClusterBuilder(this.clusters);
    }
  }

  private getOrCreateClusterBuilder(): IncrementalClusterBuilder {
    if (!this.clusterBuilder) {
      this.clusterBuilder = new IncrementalClusterBuilder(this.clusters);
    }
    return this.clusterBuilder;
  }

  private applyPendingVacancies(): void {
    if (this.pendingVacancies.length === 0) return;
    const pending = this.pendingVacancies;
    this.pendingVacancies = [];
    const builder = this.getOrCreateClusterBuilder();
    const { updatedClusters, newClusters } = builder.addVacancies(pending);
    this.clusters = builder.getClusters();
    const affected = [...updatedClusters, ...newClusters];
    if (affected.length > 0 && typeof this.pool.saveClusters === 'function') {
      this.pool.saveClusters(affected);
    }
  }

  /**
   * Обходит выборку ссылок площадки. Улов может исправно приходить свежим у
   * объявлений, которых на сайте уже нет; единственное доказательство — сходить
   * по адресу. Снятое объявление уходит из пула и остаётся в базе с датой
   * смерти (B200 срез 2).
   *
   * Возвращает `undefined`, когда обход не делался: без пробы и без записей
   * измерения нет, а показывать неизмеренное числом нельзя.
   */
  public async probeSourceLinks(
    sourceId: string,
    nowMs: number = Date.now(),
    sample: number = DEFAULT_LINK_SAMPLE,
  ): Promise<LinkCheckCensus | undefined> {
    if (!this.linkProbe) return undefined;
    const source = this.sources.get(sourceId);
    if (!source || !source.enabled) return undefined;

    // Обходу нужны только адреса: срез hh.ru в сотни тысяч записей целиком в
    // куче ради выборки из десятка ссылок — это то, от чего уходит B221.
    const links = this.pool.loadSourceLinks(sourceId);
    if (links.length === 0) return undefined;

    const { census, goneVacancyIds } = await probeVacancyLinks(links, this.linkProbe, {
      sample,
      nowMs,
    });

    this.observations.set(
      sourceId,
      recordLinkCheck(this.observations.get(sourceId) ?? emptySourceObservations(), census),
    );
    this.linkCheckedAt.set(sourceId, nowMs);

    if (goneVacancyIds.length > 0) {
      this.pool.markExpired(goneVacancyIds, census.checkedAt);
      if (this.reclusterMode.mode === 'keyed') {
        // Снятая ссылка уходит из своего кластера по ключу члена, без чтения
        // всех кластеров в кучу (B230). Ссылки уже в руках — из выборки обхода.
        const goneSet = new Set(goneVacancyIds);
        detachVacanciesByKeys(
          this.keyedStore(),
          links.filter((link) => goneSet.has(link.id)),
        );
      } else {
        this.handleExpiredVacancies(goneVacancyIds);
        this.poolChangedSinceRecluster = true;
        this.reclusterIfChanged();
      }
    }
    this.persistSourceState(source);
    return census;
  }

  private handleExpiredVacancies(goneVacancyIds: readonly string[]): void {
    if (this.clusters.length === 0 && this.pool.countClusters() > 0) {
      this.clusters = this.pool.loadClusters();
    }
    const goneSet = new Set(goneVacancyIds);
    let clustersChanged = false;
    this.clusters = this.clusters.map((cluster) => {
      const next = expireClusterSources(cluster, goneSet);
      if (next === cluster) return cluster;
      this.pool.upsertCluster(next);
      clustersChanged = true;
      return next;
    });
    if (clustersChanged) {
      this.clusterBuilder = new IncrementalClusterBuilder(this.clusters);
    }
  }

  /**
   * Один обход за раз, у площадки, чьи ссылки проверяли дольше всех. Обход по
   * всем площадкам сразу — это залп по чужим серверам, а очередь по одной
   * держит нагрузку на уровне десятка запросов за такт (B200 срез 2, B204).
   */
  public async probeDueLinks(nowMs: number = Date.now()): Promise<LinkCheckCensus | undefined> {
    if (!this.linkProbe) return undefined;
    const candidates = [...this.sources.values()].filter((source) => {
      if (!source.enabled) return false;
      return this.pool.countSourceSlice(source.id).total > 0;
    });
    if (candidates.length === 0) return undefined;

    const oldest = candidates.reduce((best, source) =>
      (this.linkCheckedAt.get(source.id) ?? 0) < (this.linkCheckedAt.get(best.id) ?? 0)
        ? source
        : best,
    );
    return this.probeSourceLinks(oldest.id, nowMs);
  }

  private persistSourceState(source: VacancySourceConfig): void {
    const observations = this.observations.get(source.id);
    const schedule = this.scheduler.exportState()[source.id] ?? null;
    this.pool.saveSourceState({
      sourceId: source.id,
      ...(observations ? { observations: { ...observations, schedule } } : {}),
      ...(source.lastSyncAt ? { lastSyncAt: source.lastSyncAt } : {}),
      ...(source.lastStatus ? { lastStatus: source.lastStatus } : {}),
      ...(source.lastErrorMessage ? { lastErrorMessage: source.lastErrorMessage } : {}),
      itemsFoundTotal: source.itemsFoundTotal,
      itemsActiveTotal: source.itemsActiveTotal,
      ...(source.syncRequestedAt ? { syncRequestedAt: source.syncRequestedAt } : {}),
      ...(source.syncStartedAt ? { syncStartedAt: source.syncStartedAt } : {}),
    });
  }

  /**
   * Syncs the sources whose own refresh interval has elapsed. Without this
   * nothing but an admin button ever filled the pool, so a fresh process — and
   * therefore every deploy — served an empty «Возможности» until someone
   * pressed it by hand (B161 review §2).
   */
  public async syncDue(nowMs: number = Date.now()): Promise<SourceSyncOutcome[]> {
    const due = Array.from(this.sources.values())
      .filter((source) => source.enabled && !source.requiresQuery && this.isDue(source, nowMs))
      .sort((left, right) => tierOf(left) - tierOf(right) || lastSyncMs(left) - lastSyncMs(right));
    // Мёртвую площадку плановый опрос не выбирает: вежливость к чужому серверу
    // этим и измеряется (B200). Вердикт снимается только новым замером, поэтому
    // раз в неделю одна такая площадка за такт получает повторный опрос.
    const dead = due.filter((source) => isDeadSource(this.healthOf(source.id, nowMs)));
    const deadIds = new Set(dead.map((source) => source.id));
    const rechecks = dead
      .filter((source) => nowMs - lastSyncMs(source) >= DEAD_SOURCE_RECHECK_MS)
      .slice(0, DEAD_SOURCE_RECHECKS_PER_TICK);
    // B628: источник, который ещё опрашивается прошлой волной, места не занимает.
    const ready = due.filter(
      (source) =>
        !deadIds.has(source.id) && !this.holdSource(source) && !this.running.has(source.id),
    );
    const companyLane = pickCompanyLane(
      ready.filter((source) => tierOf(source) === 1),
      COMPANY_LANE_LIMIT,
      companyLanePerHost,
      sourceHost,
    );
    const live = pickWave(
      ready.filter((source) => tierOf(source) !== 1),
      SYNC_BATCH_LIMIT - rechecks.length,
      tierOf,
    );
    const outcomes = (
      await Promise.all([
        mapWithConcurrency(companyLane, COMPANY_LANE_CONCURRENCY, (source) =>
          this.syncWithinLane(source.id, nowMs),
        ),
        Promise.all([
          ...live.map((source) => this.syncOne(source.id, undefined, nowMs)),
          ...rechecks.map((source) => this.recheckDeadSource(source.id, nowMs)),
        ]),
      ])
    ).flat();
    this.reclusterIfChanged();
    return outcomes;
  }

  /** Опрос канала компании с потолком ожидания: зависший сайт не держит место полосы. */
  private syncWithinLane(sourceId: string, nowMs: number): Promise<SourceSyncOutcome> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<SourceSyncOutcome>((resolve) => {
      timer = setTimeout(
        () => resolve({ sourceId, status: 'lane_timeout', fetched: 0, kept: 0 }),
        this.companyLaneSourceTimeoutMs,
      );
    });
    return Promise.race([this.syncOne(sourceId, undefined, nowMs), timeout]).finally(() =>
      clearTimeout(timer),
    );
  }

  private async recheckDeadSource(sourceId: string, nowMs: number): Promise<SourceSyncOutcome> {
    const linksWereDead =
      this.healthOf(sourceId, nowMs).liveness.pausedBecause === 'links_not_opening';
    const outcome = await this.syncOne(sourceId, undefined, nowMs);
    if (linksWereDead) await this.probeSourceLinks(sourceId, nowMs, DEAD_SOURCE_LINK_SAMPLE);
    return outcome;
  }

  /**
   * Спрашивает у площадки её собственное правило и подчиняется ему. Запрет
   * словами — не отговорка расписания, а отказ от запроса: продукт не ходит
   * туда, куда ему сказали не ходить (B204).
   */
  private async robotsPermission(
    source: VacancySourceConfig,
    nowMs: number,
  ): Promise<{ disallowed: boolean; reason?: string }> {
    if (!this.robots) return { disallowed: false };
    // Разрешение владельца поверх robots — только явное, с основанием в
    // реестре (B217). Молчаливого исключения здесь нет.
    if (source.robotsOverride) return { disallowed: false };
    const policy = await this.robots.policyFor(source.targetUrl, nowMs);
    if (policy.verdict === 'unconfirmed') return { disallowed: false };
    this.scheduler.setRobotsPolicy(source.id, policy);
    return policy.verdict === 'disallowed'
      ? { disallowed: true, reason: 'robots_txt_disallows_this_address' }
      : { disallowed: false };
  }

  private isDue(source: VacancySourceConfig, nowMs: number): boolean {
    const addressStatus = (source as { addressStatus?: string }).addressStatus;
    if (addressStatus === 'robots_forbidden') return false;
    const interval = source.refreshIntervalMinutes * TIER_INTERVAL_FACTOR[tierOf(source)];
    const status = this.scheduler.isSourceDue(source.id, interval, nowMs);
    return status.due;
  }

  public getScheduler(): PoliteScheduler {
    return this.scheduler;
  }

  /**
   * Ручной опрос всех площадок. Идёт волнами той же ширины, что и плановый:
   * залп из 195 одновременных запросов кончился 92 ложными отказами по таймауту
   * на проде 2026-09-06 (B202, B204).
   */
  public async syncAll(query?: string): Promise<SourceSyncOutcome[]> {
    if (forbidsDirectSourceSync(this.reclusterMode)) {
      throw new ReclusterDisabledError('source sync is owned by the maintenance process');
    }
    const enabled = Array.from(this.sources.values()).filter((s) => s.enabled);
    const outcomes = await mapWithConcurrency(enabled, SYNC_BATCH_LIMIT, (source) =>
      this.syncOne(source.id, query, Date.now()),
    );
    this.reclusterIfChanged();
    return outcomes;
  }

  /**
   * Вход сведения читается из хранилища и живёт в куче только на время
   * сборки: кластеры не держат ссылок на записи, поэтому после сборки пул
   * снова занимает ноль байт кучи (B221). Полная пересборка остаётся до
   * среза 3 (кластеры в таблице, инкрементально).
   */
  public recluster(): void {
    if (forbidsFullRecluster(this.reclusterMode)) throw new ReclusterDisabledError();
    const startedAt = Date.now();
    this.ensureLoadedClusters();
    if (this.requiresFullRecluster) {
      this.rebuildClustersFromPool();
      this.finishRecluster(startedAt, true);
      return;
    }
    if (
      this.clusters.length === 0 &&
      this.pool.countVacancies(freshnessWindow()) > this.pendingVacancies.length
    ) {
      const freshVacancies = this.pool.iterateClusterInput(freshnessWindow());
      this.clusters = clusterVacancies(freshVacancies);
      this.pendingVacancies = [];
      this.finishRecluster(startedAt, true);
    } else {
      this.applyPendingVacancies();
      this.finishRecluster(startedAt, false);
    }
  }

  public async reclusterAsync(chunkSize = 500): Promise<void> {
    if (forbidsFullRecluster(this.reclusterMode)) throw new ReclusterDisabledError();
    const startedAt = Date.now();
    this.ensureLoadedClusters();
    if (this.requiresFullRecluster) {
      const freshVacancies = this.pool.iterateClusterInput(freshnessWindow());
      this.clusters = await clusterVacanciesAsync(freshVacancies, chunkSize);
      this.pendingVacancies = [];
      this.finishRecluster(startedAt, true);
      return;
    }
    if (
      this.clusters.length === 0 &&
      this.pool.countVacancies(freshnessWindow()) > this.pendingVacancies.length
    ) {
      const freshVacancies = this.pool.iterateClusterInput(freshnessWindow());
      this.clusters = await clusterVacanciesAsync(freshVacancies, chunkSize);
      this.pendingVacancies = [];
      this.finishRecluster(startedAt, true);
    } else {
      this.applyPendingVacancies();
      this.finishRecluster(startedAt, false);
    }
  }

  private finishRecluster(startedAt: number, didFullRecluster = false): void {
    if (didFullRecluster) {
      this.clusterBuilder = new IncrementalClusterBuilder(this.clusters);
      if (typeof this.pool.replaceClusters === 'function') {
        this.pool.replaceClusters(this.clusters);
      } else if (typeof this.pool.saveClusters === 'function') {
        this.pool.saveClusters(this.clusters);
        const currentIds = new Set(this.clusters.map((cluster) => cluster.id));
        for (const persisted of this.pool.loadClusters()) {
          if (!currentIds.has(persisted.id)) this.pool.deleteCluster(persisted.id);
        }
      }
      this.requiresFullRecluster = false;
    }
    this.poolChangedSinceRecluster = false;
    this.reclusterCount += 1;
    this.lastReclusterMs = Date.now() - startedAt;
  }

  private rebuildClustersFromPool(): void {
    const previous = this.clusters;
    this.clusters = clusterVacancies(this.pool.iterateClusterInput(freshnessWindow()));
    this.pendingVacancies = [];
    const currentIds = new Set(this.clusters.map((cluster) => cluster.id));
    if (typeof this.pool.deleteCluster === 'function') {
      for (const cluster of previous) {
        if (!currentIds.has(cluster.id)) this.pool.deleteCluster(cluster.id);
      }
    }
  }

  /** Что видно снаружи о сведении: для замера на проде без профилировщика (B221). */
  public get reclusterStats(): {
    clusters: number;
    pending: number;
    keyedClusterings: number;
    rebuilds: number;
    lastReclusterMs: number;
    inFlight: boolean;
  } {
    return {
      clusters: this.clusters.length,
      pending: this.pendingVacancies.length,
      keyedClusterings: this.keyedClusterings,
      rebuilds: this.reclusterCount,
      lastReclusterMs: this.lastReclusterMs,
      inFlight: this.reclusterInFlight !== undefined,
    };
  }

  /**
   * Сколько раз пул пересобирался. Не украшение: именно двенадцать пересборок
   * подряд в одной волне держали процесс и не давали дочитать ответы
   * остальным площадкам (прод 2026-09-06, B202/B204).
   */
  public get clusterRebuildCount(): number {
    return this.reclusterCount;
  }

  /** Пересобирает пул, только если волна что-то в него принесла. */
  private reclusterIfChanged(): void {
    if (!this.poolChangedSinceRecluster) return;
    if (this.reclusterMode.mode === 'sync') {
      this.recluster();
      return;
    }
    if (this.reclusterMode.mode !== 'background') return;
    this.requestBackgroundRecluster(this.reclusterMode.minIntervalMs);
  }

  /**
   * Фоновая сборка: одна за раз и не чаще, чем раз в `minIntervalMs`. Волна,
   * пришедшая раньше срока, ставит одну отложенную сборку; поздняя — ждёт
   * окончания текущей и запускается следом, если пул успел измениться.
   */
  private requestBackgroundRecluster(minIntervalMs: number): void {
    if (this.reclusterInFlight || this.reclusterTimer) return;
    const dueInMs = this.reclusterFinishedAt + minIntervalMs - Date.now();
    if (dueInMs > 0) {
      this.reclusterTimer = setTimeout(() => {
        this.reclusterTimer = undefined;
        this.requestBackgroundRecluster(minIntervalMs);
      }, dueInMs);
      this.reclusterTimer.unref?.();
      return;
    }
    this.reclusterInFlight = this.reclusterAsync()
      .catch(() => undefined)
      .finally(() => {
        this.reclusterInFlight = undefined;
        this.reclusterFinishedAt = Date.now();
        if (this.poolChangedSinceRecluster) this.requestBackgroundRecluster(minIntervalMs);
      });
  }

  /** Идущая фоновая сборка, если есть — чтобы дождаться её в тестах и при остановке. */
  public get backgroundRecluster(): Promise<void> | undefined {
    return this.reclusterInFlight;
  }

  /**
   * Один и тот же кандидат (с уже решённым режимом) идёт и в запрос, и в
   * объяснение (B267 S3): иначе таблица могла наполниться между двумя
   * вызовами `resolveSemanticFunctions`, и `roleMatch` объяснял бы не то,
   * что нашёл запрос.
   */
  private withResolvedSemanticFunctions(candidate: CandidateMatchProfile): CandidateMatchProfile {
    const functions = this.pool.resolveSemanticFunctions?.(candidate);
    return functions?.length ? { ...candidate, semanticRoleFunctions: functions } : candidate;
  }

  public getMatchedVacancies(candidate: CandidateMatchProfile): MatchedVacancyItem[] {
    const effective = this.withResolvedSemanticFunctions(candidate);
    const clusters =
      typeof this.pool.queryMatchCandidates === 'function'
        ? clusterVacancies(this.pool.queryMatchCandidates(effective)).filter(
            (c) => c.status === 'active',
          )
        : this.getActiveClusters();

    const matched: MatchedVacancyItem[] = [];
    for (const cluster of clusters) {
      const explanation = matchCandidateWithVacancy(effective, cluster);
      matched.push({ cluster, explanation });
    }

    return matched.sort(compareMatchedVacancies);
  }

  public async getMatchedVacanciesAsync(
    candidate: CandidateMatchProfile,
  ): Promise<MatchedVacancyItem[]> {
    if (!this.pool.queryMatchCandidatesAsync) return this.getMatchedVacancies(candidate);
    const effective = this.withResolvedSemanticFunctions(candidate);
    const clusters = clusterVacancies(await this.pool.queryMatchCandidatesAsync(effective)).filter(
      (cluster) => cluster.status === 'active',
    );
    const matched = await mapYielding(clusters, (cluster) => ({
      cluster,
      explanation: matchCandidateWithVacancy(effective, cluster),
    }));
    return matched.sort(compareMatchedVacancies);
  }

  public async testSource(
    sourceId: string,
    query?: string,
  ): Promise<{
    sourceId: string;
    sourceName: string;
    type: string;
    success: boolean;
    latencyMs: number;
    count: number;
    vacancies: UnifiedVacancy[];
    message?: string;
  }> {
    const source = this.sources.get(sourceId);
    if (!source) {
      throw new Error(`Источник вакансий ${sourceId} не найден`);
    }
    const start = Date.now();
    try {
      if (!this.fetcher) {
        throw new Error('vacancy_source_transport_unavailable');
      }
      const reading = await this.fetcher(source, { query });
      // Пробный опрос показывает то, что площадка отдала сейчас; полное это
      // чтение или частичное — для пробы значения не имеет.
      const fetched: UnifiedVacancy[] = Array.isArray(reading) ? reading : reading.vacancies;
      const latencyMs = Date.now() - start;
      return {
        sourceId: source.id,
        sourceName: source.name,
        type: source.type,
        success: true,
        latencyMs,
        count: fetched.length,
        vacancies: fetched.slice(0, 15),
      };
    } catch (err) {
      const latencyMs = Date.now() - start;
      return {
        sourceId: source.id,
        sourceName: source.name,
        type: source.type,
        success: false,
        latencyMs,
        count: 0,
        vacancies: [],
        message: failureMessage(err),
      };
    }
  }
}

export { expireClusterSources } from './clusterExpiry';

/** После стольких ответов «доступ ограничен» текст считается скрытым работодателем. */
const HIDDEN_TEXT_ANSWERS = 2;

/** Кластеров снятых hh-записей за такт: точечные записи, не обход всех кластеров. */
const EXPIRED_CLUSTER_BATCH = 50;

function yieldTurn(): Promise<void> {
  return new Promise<void>((resolve) => setImmediate(resolve));
}
