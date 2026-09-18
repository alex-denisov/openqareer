/* eslint-disable max-lines -- source synchronization and membership lifecycle
   are intentionally kept together so replacement, expiry and reclustering share
   one transaction boundary. */
import { compareMatchedVacancies } from '../../shared/vacancyMatchOrder';
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
import { freshnessWindow, isWithin, parseMs, MAX_VACANCY_AGE_DAYS } from './vacancyPoolQuery';
import type { VacancyPoolStore } from './vacancyPoolStore';

import { PoliteScheduler, type SourceScheduleInfo } from './politeScheduler';

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

/**
 * What one sync actually did. `syncSource` used to return `void`, so an admin
 * route could only answer `success: true` — including for a run that failed
 * outright and for a source id that does not exist (B161 review §3).
 */
export interface SourceSyncOutcome {
  readonly sourceId: string;
  readonly status: 'healthy' | 'error' | 'unknown_source' | 'disabled' | 'skipped_needs_query';
  /** How many records the source returned before the freshness filter. */
  readonly fetched: number;
  /** How many of them the pool now holds for this source. */
  readonly kept: number;
  readonly message?: string;
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

function isVacancyFresh(publishedAt: string, nowMs: number = Date.now()): boolean {
  return isWithin(parseMs(publishedAt), freshnessWindow(nowMs));
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
 * Как движок пересобирает кластеры после волны опроса.
 *
 * `sync` — сразу и в этом же вызове: тесты и маленькие пулы. `background` —
 * асинхронно, уступая цикл событий, и не чаще раза в `minIntervalMs`; чтение
 * никогда не ждёт сборки и отдаёт текущие кластеры. На проде разбор 173 000
 * записей из базы стоит 1–2 минуты процессора: синхронная сборка на каждую
 * пятиминутную волну держала службу без ответа и была откачена
 * (2026-09-15, B221). Полная пересборка уходит со срезом 3.
 */
export type ReclusterMode = { mode: 'sync' } | { mode: 'background'; minIntervalMs: number };

export const DEFAULT_RECLUSTER_MIN_INTERVAL_MS = 15 * 60 * 1000;

function lastSyncMs(source: VacancySourceConfig): number {
  if (!source.lastSyncAt) return 0;
  const parsed = Date.parse(source.lastSyncAt);
  return Number.isNaN(parsed) ? 0 : parsed;
}

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
          : undefined;

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
  private sources: Map<string, VacancySourceConfig> = new Map();
  private clusters: VacancyCluster[] = [];
  private clusterBuilder?: IncrementalClusterBuilder;
  private pendingVacancies: UnifiedVacancy[] = [];
  /** A complete source replacement invalidates the old cluster membership. */
  private requiresFullRecluster = false;
  private fetcher?: SourceFetcher;
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

  constructor(options?: {
    sources?: VacancySourceConfig[];
    fetcher?: SourceFetcher;
    pool?: VacancyPoolStore;
    robots?: RobotsPolicyLoader;
    linkProbe?: LinkProbe;
    recluster?: ReclusterMode;
  }) {
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
      source.lastErrorMessage = state.lastErrorMessage;
      source.itemsFoundTotal = state.itemsFoundTotal;
      source.itemsActiveTotal = state.itemsActiveTotal;
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
  ): Promise<{ restored: number }> {
    this.pruneStore(nowMs);
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
    if (typeof this.pool.countClusters === 'function' && this.pool.countClusters() > 0) {
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
  public getSourceHealthReport(nowMs: number = Date.now()): SourceHealthReportItem[] {
    return Array.from(this.sources.values()).map((source) => ({
      sourceId: source.id,
      sourceName: source.name,
      ...this.healthOf(source.id, nowMs),
      schedule: this.scheduler.getScheduleInfo(source.id, nowMs, source.refreshIntervalMinutes),
    }));
  }

  private healthOf(sourceId: string, nowMs: number): SourceHealth {
    const rawObs = this.observations.get(sourceId) ?? emptySourceObservations();
    this.ensureClusters();
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
   * Собирает кластеры, если пул менялся с прошлой сборки — только в режиме
   * `sync`. В фоновом режиме чтение отдаёт то, что есть: одно «медленное
   * чтение» на проде — это минуты без ответа для всех (B221).
   */
  private ensureClusters(): void {
    if (
      this.clusters.length === 0 &&
      typeof this.pool.countClusters === 'function' &&
      this.pool.countClusters() > 0
    ) {
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

  /** Есть ли запись в пуле — по индексу, без чтения текста (быстрый проход hh, B219). */
  public hasVacancy(id: string): boolean {
    return this.pool.hasVacancy(id);
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

  public async syncSource(
    sourceId: string,
    query?: string,
    nowMs: number = Date.now(),
  ): Promise<SourceSyncOutcome> {
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

    const kept = this.acceptReading(source, fetched, nowMs, partial, dropObservedBefore);
    return { sourceId: source.id, status: 'healthy', fetched: fetched.length, kept };
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
      const message = err instanceof Error ? err.message : String(err);
      // Провал транспорта — не пустой улов: про содержимое площадки он не
      // говорит ничего, поэтому серию пустых уловов он не удлиняет (B200).
      this.observe(source.id, { succeeded: false, atMs: nowMs });
      source.lastSyncAt = new Date(nowMs).toISOString();
      source.lastStatus = 'error';
      source.lastErrorMessage = message;

      const { statusCode, retryAfterHeader } = extractErrorHttpDetails(err);
      this.scheduler.recordAttempt(source.id, {
        success: false,
        statusCode,
        retryAfterHeader,
        nowMs,
      });

      this.persistSourceState(source);
      // A failed reading is not evidence that the source went empty, so the
      // slice it delivered last time stays until a successful run replaces it.
      return { sourceId, status: 'error', fetched: 0, kept: 0, message };
    }
  }

  /**
   * Принимает удачный улов: свежая часть заменяет прежний срез площадки, и
   * состояние источника переписывается по этому же чтению. Возвращает, сколько
   * записей пул оставил.
   */
  private acceptReading(
    source: VacancySourceConfig,
    fetched: readonly UnifiedVacancy[],
    nowMs: number,
    partial = false,
    dropObservedBefore?: string,
  ): number {
    // Название площадки едет вместе с записью: на экране кандидат читает
    // источник, а не тип адаптера (PRB-017).
    const freshFetched = fetched
      .filter((v) => isVacancyFresh(v.publishedAt))
      .map((v) =>
        v.provenance ? { ...v, provenance: { ...v.provenance, sourceName: source.name } } : v,
      );
    const changedExistingMembership = partial && freshFetched.some((vacancy) => {
      const previous = this.pool.getVacancy(vacancy.id);
      if (!previous) return false;
      return JSON.stringify({
        title: previous.title,
        company: previous.company,
        description: previous.description,
        requiredSkills: previous.requiredSkills,
        url: previous.url,
        location: previous.location,
        salary: previous.salary,
      }) !== JSON.stringify({
        title: vacancy.title,
        company: vacancy.company,
        description: vacancy.description,
        requiredSkills: vacancy.requiredSkills,
        url: vacancy.url,
        location: vacancy.location,
        salary: vacancy.salary,
      });
    });

    // A successful sync replaces this source's slice. Merging instead meant a
    // vacancy the employer took down an hour after one reading stayed
    // matchable — and openable — for thirty days (B161 review §1).
    //
    // Частичное чтение — исключение, и только оно: источник показал часть
    // выдачи и про остальное ничего не сказал, поэтому «нет в улове» здесь не
    // значит «снято». Срез дополняется, а устаревшее убирает тридцатидневная
    // уборка и проверка живости ссылок (B214).
    if (partial) this.pool.mergeSourceSlice(source.id, freshFetched, dropObservedBefore);
    else {
      this.pool.replaceSourceSlice(source.id, freshFetched);
      this.requiresFullRecluster = true;
    }
    if (dropObservedBefore) this.requiresFullRecluster = true;
    if (changedExistingMembership) this.requiresFullRecluster = true;
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

    if (freshFetched.length > 0) {
      this.pendingVacancies.push(...freshFetched);
    }
    this.poolChangedSinceRecluster = true;
    return freshFetched.length;
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
  ): Promise<LinkCheckCensus | undefined> {
    if (!this.linkProbe) return undefined;
    const source = this.sources.get(sourceId);
    if (!source || !source.enabled) return undefined;

    // Обходу нужны только адреса: срез hh.ru в сотни тысяч записей целиком в
    // куче ради выборки из десятка ссылок — это то, от чего уходит B221.
    const links = this.pool.loadSourceLinks(sourceId);
    if (links.length === 0) return undefined;

    const { census, goneVacancyIds } = await probeVacancyLinks(links, this.linkProbe, {
      sample: DEFAULT_LINK_SAMPLE,
      nowMs,
    });

    this.observations.set(
      sourceId,
      recordLinkCheck(this.observations.get(sourceId) ?? emptySourceObservations(), census),
    );
    this.linkCheckedAt.set(sourceId, nowMs);

    if (goneVacancyIds.length > 0) {
      this.pool.markExpired(goneVacancyIds, census.checkedAt);
      this.handleExpiredVacancies(goneVacancyIds);
      this.poolChangedSinceRecluster = true;
      this.reclusterIfChanged();
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
    for (const cluster of this.clusters) {
      const match =
        goneSet.has(cluster.id.replace(/^cluster-/, '')) ||
        cluster.sources.some(
          (s) =>
            (s.externalId && goneSet.has(s.externalId)) ||
            (s.sourceUrl && goneSet.has(s.sourceUrl)),
        );
      if (!match) continue;
      if (cluster.vacanciesCount <= 1) {
        cluster.status = 'archived';
        this.pool.upsertCluster(cluster);
        clustersChanged = true;
      } else {
        cluster.vacanciesCount -= 1;
        this.pool.upsertCluster(cluster);
        clustersChanged = true;
      }
    }
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
    });
  }

  /**
   * Syncs the sources whose own refresh interval has elapsed. Without this
   * nothing but an admin button ever filled the pool, so a fresh process — and
   * therefore every deploy — served an empty «Возможности» until someone
   * pressed it by hand (B161 review §2).
   */
  public async syncDue(nowMs: number = Date.now()): Promise<SourceSyncOutcome[]> {
    const due = Array.from(this.sources.values()).filter(
      (source) =>
        source.enabled &&
        !source.requiresQuery &&
        this.isDue(source, nowMs) &&
        // Мёртвую площадку плановый опрос не выбирает: свежего улова с неё уже
        // полгода нет, а вежливость к чужому серверу этим и измеряется (B200).
        !isDeadSource(this.healthOf(source.id, nowMs)),
    );
    const batch = [...due]
      .sort((left, right) => lastSyncMs(left) - lastSyncMs(right))
      .slice(0, SYNC_BATCH_LIMIT);
    const outcomes = await Promise.all(
      batch.map((source) => this.syncOne(source.id, undefined, nowMs)),
    );
    this.reclusterIfChanged();
    return outcomes;
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
    const status = this.scheduler.isSourceDue(source.id, source.refreshIntervalMinutes, nowMs);
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
    rebuilds: number;
    lastReclusterMs: number;
    inFlight: boolean;
  } {
    return {
      clusters: this.clusters.length,
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

  public getMatchedVacancies(candidate: CandidateMatchProfile): MatchedVacancyItem[] {
    const clusters =
      typeof this.pool.queryMatchCandidates === 'function'
        ? clusterVacancies(this.pool.queryMatchCandidates(candidate)).filter(
            (c) => c.status === 'active',
          )
        : this.getActiveClusters();

    const matched: MatchedVacancyItem[] = [];
    for (const cluster of clusters) {
      const explanation = matchCandidateWithVacancy(candidate, cluster);
      matched.push({ cluster, explanation });
    }

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
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
