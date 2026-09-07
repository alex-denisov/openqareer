import { compareMatchedVacancies } from '../../shared/vacancyMatchOrder';
import type {
  UnifiedVacancy,
  VacancyCluster,
  VacancyMatchExplanation,
  VacancySourceConfig,
} from '../domain/unifiedVacancy';
import { calculateSourceAuthenticity, clusterVacancies } from './vacancyDeduplicator';
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
import type { VacancyPoolStore } from './vacancyPoolStore';

import {
  PoliteScheduler,
  type SourceScheduleInfo,
} from './politeScheduler';

export type SourceFetcher = (
  source: VacancySourceConfig,
  options?: { query?: string },
) => Promise<UnifiedVacancy[]>;

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

const MAX_VACANCY_AGE_DAYS = 30;

function isVacancyFresh(
  publishedAt: string,
  nowMs: number = Date.now(),
  maxAgeDays: number = MAX_VACANCY_AGE_DAYS,
): boolean {
  const pubTime = new Date(publishedAt).getTime();
  if (Number.isNaN(pubTime)) return false;
  const ageMs = nowMs - pubTime;
  return ageMs >= 0 && ageMs <= maxAgeDays * 24 * 60 * 60 * 1000;
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
      | { get?: (k: string) => string | null }
      | undefined);

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
  private rawVacancies: Map<string, UnifiedVacancy> = new Map();
  private clusters: VacancyCluster[] = [];
  private fetcher?: SourceFetcher;
  /** Where the pool survives a restart. Absent means memory only (tests). */
  private readonly pool?: VacancyPoolStore;
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
  }) {
    const initial = options?.sources ?? DEFAULT_VACANCY_SOURCES;
    for (const src of initial) {
      this.sources.set(src.id, { ...src });
      this.rememberRight(src);
      this.configureSourcePoliteness(src);
    }
    this.fetcher = options?.fetcher;
    this.pool = options?.pool;
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

  /**
   * Loads what an earlier process synced. Without it a restart — and therefore
   * every deploy — served an empty «Возможности» until the scheduler's next
   * run, and every source claimed it had never been read (B164).
   */
  public restore(nowMs: number = Date.now()): { restored: number } {
    if (!this.pool) return { restored: 0 };
    const oldestPublishedAt = new Date(
      nowMs - MAX_VACANCY_AGE_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();
    this.pool.prune(Array.from(this.sources.keys()), oldestPublishedAt);

    this.rawVacancies.clear();
    for (const vacancy of this.pool.loadVacancies()) {
      // A source the registry no longer lists must not come back through
      // storage. A disabled one keeps its slice, exactly as it does in memory
      // when it is switched off between syncs.
      if (!this.sources.has(vacancy.provenance.sourceId)) continue;
      if (!isVacancyFresh(vacancy.publishedAt, nowMs)) continue;
      this.rawVacancies.set(vacancy.id, vacancy);
    }

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

    this.recluster();
    return { restored: this.rawVacancies.size };
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
    return this.clusters.filter((c) => c.status === 'active');
  }

  /**
   * Одна запись целиком: список отдаётся кратким видом внутри байтового бюджета
   * маршрута (INC-032), а полный текст поста читает карточка.
   */
  public getVacancy(id: string): UnifiedVacancy | undefined {
    return this.rawVacancies.get(id);
  }

  public getVacancies(filter: VacancyQueryFilter = {}): VacancyQueryResult {
    let all = Array.from(this.rawVacancies.values()).filter((v) =>
      isVacancyFresh(v.publishedAt),
    );

    const statsMap = new Map<string, number>();
    for (const v of all) {
      const sId = v.provenance?.sourceId ?? 'unknown';
      statsMap.set(sId, (statsMap.get(sId) ?? 0) + 1);
    }
    const statsBySource = Array.from(this.sources.values()).map((s) => ({
      sourceId: s.id,
      sourceName: s.name,
      count: statsMap.get(s.id) ?? 0,
    }));

    if (filter.sourceId) {
      all = all.filter((v) => v.provenance?.sourceId === filter.sourceId);
    }
    if (filter.type) {
      all = all.filter((v) => v.provenance?.sourceType === filter.type);
    }
    if (filter.isRemote !== undefined) {
      all = all.filter((v) => v.isRemote === filter.isRemote);
    }
    if (filter.query) {
      const q = filter.query.toLowerCase();
      all = all.filter(
        (v) =>
          v.title.toLowerCase().includes(q) ||
          v.company.toLowerCase().includes(q) ||
          (v.description && v.description.toLowerCase().includes(q)) ||
          v.requiredSkills.some((s) => s.toLowerCase().includes(q)),
      );
    }

    // Sort newest first
    all.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());

    const total = all.length;
    const offset = filter.offset ?? 0;
    const limit = filter.limit ?? 20;
    const items = all.slice(offset, offset + limit);

    return {
      total,
      items,
      statsBySource,
    };
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
    const fetched: UnifiedVacancy[] = await this.fetcher!(source, query ? { query } : undefined);

    // Перепись улова считается по тому, что площадка отдала, — до фильтра
    // свежести. Пул хранит только 30 дней, поэтому по нему доля «свежее 180
    // дней» всегда была бы 100 %: тавтология вместо меры (B200).
    this.observe(source.id, {
      succeeded: true,
      census: censusOfReading(fetched, nowMs),
      atMs: nowMs,
    });

    const newItemsCount = fetched.filter((v) => !this.rawVacancies.has(v.id)).length;
    this.scheduler.recordAttempt(source.id, {
      success: true,
      statusCode: 200,
      newItemsCount,
      nowMs,
    });

    const kept = this.acceptReading(source, fetched, nowMs);
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
  ): number {
    // Название площадки едет вместе с записью: на экране кандидат читает
    // источник, а не тип адаптера (PRB-017).
    const freshFetched = fetched
      .filter((v) => isVacancyFresh(v.publishedAt))
      .map((v) =>
        v.provenance ? { ...v, provenance: { ...v.provenance, sourceName: source.name } } : v,
      );

    // A successful sync replaces this source's slice. Merging instead meant a
    // vacancy the employer took down an hour after one reading stayed
    // matchable — and openable — for thirty days (B161 review §1).
    this.replaceSourceSlice(source.id, freshFetched);

    // The clock of the run, so the next due check measures the same instant
    // the scheduler used rather than drifting against wall time.
    source.lastSyncAt = new Date(nowMs).toISOString();
    source.lastStatus = 'healthy';
    source.lastErrorMessage = undefined;
    source.itemsFoundTotal = freshFetched.length;
    source.itemsActiveTotal = freshFetched.filter((v) => v.status === 'active').length;
    this.persistSourceState(source);

    // Пересборка кластеров — работа по всему пулу, и внутри волны она
    // повторялась на каждую площадку. Волна пересобирает пул один раз, когда
    // все ответы прочитаны (прод 2026-09-06).
    this.poolChangedSinceRecluster = true;
    return freshFetched.length;
  }

  /**
   * Swaps everything this source contributed for what it just returned. Other
   * sources are untouched, so one shrinking feed cannot empty the pool.
   */
  private replaceSourceSlice(sourceId: string, vacancies: UnifiedVacancy[]): void {
    for (const [id, vacancy] of this.rawVacancies) {
      if (vacancy.provenance?.sourceId === sourceId) this.rawVacancies.delete(id);
    }
    for (const vacancy of vacancies) {
      this.rawVacancies.set(vacancy.id, vacancy);
    }
    this.pool?.replaceSourceSlice(sourceId, vacancies);
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

    const slice = [...this.rawVacancies.values()].filter(
      (vacancy) => vacancy.provenance?.sourceId === sourceId,
    );
    if (slice.length === 0) return undefined;

    const { census, goneVacancyIds } = await probeVacancyLinks(slice, this.linkProbe, {
      sample: DEFAULT_LINK_SAMPLE,
      nowMs,
    });

    this.observations.set(
      sourceId,
      recordLinkCheck(this.observations.get(sourceId) ?? emptySourceObservations(), census),
    );
    this.linkCheckedAt.set(sourceId, nowMs);

    if (goneVacancyIds.length > 0) {
      for (const id of goneVacancyIds) this.rawVacancies.delete(id);
      this.pool?.markExpired(goneVacancyIds, census.checkedAt);
      this.poolChangedSinceRecluster = true;
      this.reclusterIfChanged();
    }
    this.persistSourceState(source);
    return census;
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
      return [...this.rawVacancies.values()].some((v) => v.provenance?.sourceId === source.id);
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
    this.pool?.saveSourceState({
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

  public recluster(): void {
    const freshVacancies = Array.from(this.rawVacancies.values()).filter((v) =>
      isVacancyFresh(v.publishedAt),
    );
    this.clusters = clusterVacancies(freshVacancies);
    this.poolChangedSinceRecluster = false;
    this.reclusterCount += 1;
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
    if (this.poolChangedSinceRecluster) this.recluster();
  }

  public getMatchedVacancies(candidate: CandidateMatchProfile): MatchedVacancyItem[] {
    const active = this.getActiveClusters();
    const matched: MatchedVacancyItem[] = [];

    for (const cluster of active) {
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
      const fetched: UnifiedVacancy[] = await this.fetcher(source, { query });
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
