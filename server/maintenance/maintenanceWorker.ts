import type { VacancySourceConfig } from '../domain/unifiedVacancy';
import { mapWithConcurrency } from '../vacancies/boundedConcurrency';
import type { LinkCheckCensus } from '../vacancies/linkLivenessProbe';
import { MemoryGuard, readProcessHeap, type HeapReading } from '../vacancies/memoryGuard';
import {
  SYNC_BATCH_LIMIT,
  type RequestedSourceSync,
  type SourceSyncOutcome,
} from '../vacancies/multiSourceVacancyEngine';

/** Тот же контракт, что у `fastify.log`: объект контекста, потом сообщение. */
export interface MaintenanceLog {
  info(context: Record<string, unknown>, message: string): void;
  warn(context: Record<string, unknown>, message: string): void;
  error(context: Record<string, unknown>, message: string): void;
}

/** Ровно то, что обслуживатель просит у движка — остальное ему не нужно. */
export interface MaintenanceEngine {
  getSources(): VacancySourceConfig[];
  restoreAsync(
    nowMs?: number,
    chunkSize?: number,
    options?: { prune?: boolean },
  ): Promise<{ restored: number }>;
  syncSource(sourceId: string): Promise<SourceSyncOutcome>;
  syncDue(nowMs?: number): Promise<SourceSyncOutcome[]>;
  getRequestedSourceSyncs(): RequestedSourceSync[];
  markSourceSyncStarted(request: RequestedSourceSync, startedAt?: string): boolean;
  clearSourceSyncRequest(request: RequestedSourceSync): boolean;
  probeDueLinks(nowMs?: number): Promise<LinkCheckCensus | undefined>;
  runCatalogMaintenanceStep(chunk?: number): { processed: number; pending: number } | undefined;
  runClusterKeysBackfillStep(chunk?: number): number;
  readonly clusterKeysReady: boolean;
  readonly poolSize: number;
}

export interface SyncWaveReport {
  readonly synced: number;
  readonly failed: readonly string[];
  readonly kept: number;
  readonly skipped?: 'stopped' | 'memory' | 'keys';
}

export interface MaintenanceIntervals {
  readonly manualSyncMs: number;
  readonly syncMs: number;
  readonly livenessMs: number;
  readonly catalogMs: number;
  readonly reportMs: number;
}

/**
 * Сколько `stop()` ждёт текущую волну. Обход hh.ru (B219) — это часы, и он
 * возобновляется с сохранённого курсора, поэтому ждать его целиком нельзя:
 * после этого срока волна бросается, хранилища закрываются, процесс выходит.
 * `TimeoutStopSec` юнита — 300 с — страховка сверху для production restore.
 */
export const DEFAULT_STOP_GRACE_MS = 60_000;

export const DEFAULT_MAINTENANCE_INTERVALS: MaintenanceIntervals = {
  manualSyncMs: 5 * 1_000,
  syncMs: 5 * 60 * 1_000,
  livenessMs: 15 * 60 * 1_000,
  catalogMs: 1_000,
  reportMs: 60 * 1_000,
};

/** Столько строк проекции каталога за один такт: одна короткая транзакция. */
export const CATALOG_STEP_CHUNK = 500;

/** Кластеров за один шаг заполнения ключей: ~5 000 строк ключей в транзакции. */
export const CLUSTER_KEYS_STEP_CHUNK = 500;

/**
 * Цикл обслуживания пула вакансий (B230, срез 1). Живёт в своём процессе с
 * малой кучей: опрашивает площадки по расписанию, достраивает проекцию
 * каталога тиками, проверяет живость ссылок и раз в минуту пишет в журнал,
 * сколько памяти занял. HTTP-процесс ничего из этого больше не делает.
 *
 * Волны могут пересекаться: обход hh.ru (B219) длится часами, и за это время
 * остальные площадки обязаны опрашиваться — движок сам не запускает одну
 * площадку дважды. На SIGTERM `stop()` ждёт идущие волны не дольше срока и
 * запрещает новые — база закрывается после.
 */
export class MaintenanceWorker {
  private readonly engine: MaintenanceEngine;
  private readonly log: MaintenanceLog;
  private readonly intervals: MaintenanceIntervals;
  private readonly memoryGuard: MemoryGuard;
  private readonly readHeap: () => HeapReading;
  private readonly timers: NodeJS.Timeout[] = [];
  private readonly inFlight = new Set<Promise<unknown>>();
  private readonly manualInFlight = new Set<string>();
  private stopped = false;

  constructor(options: {
    engine: MaintenanceEngine;
    log: MaintenanceLog;
    intervals?: Partial<MaintenanceIntervals>;
    readHeap?: () => HeapReading;
  }) {
    this.engine = options.engine;
    this.log = options.log;
    this.intervals = { ...DEFAULT_MAINTENANCE_INTERVALS, ...options.intervals };
    this.readHeap = options.readHeap ?? readProcessHeap;
    this.memoryGuard = new MemoryGuard(this.readHeap);
  }

  /**
   * Читает состояние площадок и обрезает пул порциями. С пустым набором
   * площадок `prune` стирает весь пул — такую сборку обслуживатель не
   * принимает вовсе.
   */
  async restore(): Promise<{ restored: number }> {
    if (this.engine.getSources().length === 0) {
      throw new Error('maintenance refuses to restore an engine without sources');
    }
    const startedAt = Date.now();
    const result = await this.engine.restoreAsync(Date.now(), 250, { prune: true });
    this.log.info(
      { restored: result.restored, poolSize: this.engine.poolSize, ms: Date.now() - startedAt },
      'maintenance-restored',
    );
    await this.backfillClusterKeys();
    return result;
  }

  /**
   * Ключи кластеров должны покрыть все старые кластеры до первой волны: иначе
   * сведение по ключам не найдёт соседей и наплодит дублей (B230). Шаг — одна
   * транзакция, между шагами цикл событий отпускается.
   */
  private async backfillClusterKeys(): Promise<void> {
    if (this.engine.clusterKeysReady) return;
    const startedAt = Date.now();
    let clusters = 0;
    let steps = 0;
    while (!this.stopped) {
      const processed = this.engine.runClusterKeysBackfillStep(CLUSTER_KEYS_STEP_CHUNK);
      if (processed === 0) break;
      clusters += processed;
      steps += 1;
      if (steps % 50 === 0) {
        this.log.info({ clusters, ms: Date.now() - startedAt }, 'cluster-keys-backfill-progress');
      }
      await new Promise((resolve) => setImmediate(resolve));
    }
    this.log.info(
      { clusters, ms: Date.now() - startedAt, ready: this.engine.clusterKeysReady },
      'cluster-keys-backfill-finished',
    );
  }

  /** Одна волна опросов: только площадки, у которых подошёл срок. */
  async runSyncWave(): Promise<SyncWaveReport> {
    if (this.stopped) return { synced: 0, failed: [], kept: 0, skipped: 'stopped' };
    if (!this.engine.clusterKeysReady) return { synced: 0, failed: [], kept: 0, skipped: 'keys' };
    const memory = this.memoryGuard.check();
    if (memory.changed) {
      this.log[memory.paused ? 'warn' : 'info'](
        {
          heapUsedMb: memory.heapUsedMb,
          heapLimitMb: memory.heapLimitMb,
          poolSize: this.engine.poolSize,
        },
        memory.paused ? 'multi-source-sync-paused-memory' : 'multi-source-sync-resumed-memory',
      );
    }
    if (memory.paused) return { synced: 0, failed: [], kept: 0, skipped: 'memory' };
    const wave = this.engine.syncDue().then((outcomes) => this.reportWave(outcomes));
    return this.track(wave, 'multi-source-sync-failed', { synced: 0, failed: [], kept: 0 });
  }

  private reportWave(outcomes: SourceSyncOutcome[]): SyncWaveReport {
    const synced = outcomes.filter((outcome) => outcome.status === 'healthy');
    const failed = outcomes.filter((outcome) => outcome.status === 'error');
    const report = {
      synced: synced.length,
      failed: failed.map((outcome) => outcome.sourceId),
      kept: synced.reduce((sum, outcome) => sum + outcome.kept, 0),
    };
    if (outcomes.length > 0) {
      this.log.info({ ...report, poolSize: this.engine.poolSize }, 'multi-source-sync-completed');
    }
    return report;
  }

  /** Обходит ссылки одной площадки — той, которую проверяли дольше всех (B200). */
  async runLivenessProbe(): Promise<LinkCheckCensus | undefined> {
    if (this.stopped) return undefined;
    const probe = this.engine.probeDueLinks().then((census) => {
      if (census) this.log.info({ ...census }, 'vacancy-link-liveness-checked');
      return census;
    });
    return this.track(probe, 'vacancy-link-liveness-failed', undefined);
  }

  /** Один такт проекции каталога: короткая транзакция, потом уступить (B229). */
  runCatalogStep(): { processed: number; pending: number } | undefined {
    if (this.stopped) return undefined;
    try {
      const result = this.engine.runCatalogMaintenanceStep(CATALOG_STEP_CHUNK);
      if (result && result.processed > 0) {
        this.log.info({ ...result }, 'vacancy-catalog-maintenance-tick');
      }
      return result;
    } catch (error: unknown) {
      this.log.error({ errorName: errorName(error) }, 'vacancy-catalog-maintenance-failed');
      return undefined;
    }
  }

  /** Раз в минуту — сколько занято: без этого `MemoryMax` срабатывает молча. */
  reportMemory(): void {
    const heap = this.readHeap();
    const rss = process.memoryUsage().rss;
    this.log.info(
      {
        heapUsedMb: Math.round(heap.heapUsedBytes / (1024 * 1024)),
        heapLimitMb: Math.round(heap.heapLimitBytes / (1024 * 1024)),
        rssMb: Math.round(rss / (1024 * 1024)),
        poolSize: this.engine.poolSize,
        ingestPaused: this.memoryGuard.isPaused,
      },
      'maintenance-memory',
    );
  }

  /** Заводит таймеры; первая волна — сразу, остальное по расписанию. */
  start(): void {
    const every = (ms: number, tick: () => unknown) => {
      const timer = setInterval(() => void tick(), ms);
      this.timers.push(timer);
    };
    every(this.intervals.manualSyncMs, () => this.runManualSyncWave());
    every(this.intervals.syncMs, () => this.runSyncWave());
    every(this.intervals.livenessMs, () => this.runLivenessProbe());
    every(this.intervals.catalogMs, () => this.runCatalogStep());
    every(this.intervals.reportMs, () => this.reportMemory());
    void this.runManualSyncWave();
    void this.runSyncWave();
  }

  /**
   * Выполняет только durable ручные отметки. Отметка очищается сравнением с
   * исходным timestamp, поэтому новый клик во время долгого обхода не теряется.
   */
  async runManualSyncWave(): Promise<SyncWaveReport> {
    if (this.stopped) return { synced: 0, failed: [], kept: 0, skipped: 'stopped' };
    const memory = this.memoryGuard.check();
    if (memory.paused) return { synced: 0, failed: [], kept: 0, skipped: 'memory' };
    const requests = this.engine.getRequestedSourceSyncs().slice(0, SYNC_BATCH_LIMIT);
    if (requests.length === 0) return { synced: 0, failed: [], kept: 0 };

    const work = mapWithConcurrency(requests, SYNC_BATCH_LIMIT, (request) =>
      this.runRequestedSourceSync(request),
    )
      .then((outcomes) =>
        outcomes.filter((outcome): outcome is SourceSyncOutcome => outcome !== undefined),
      )
      .then((outcomes) => {
        const report = this.reportWave(outcomes);
        this.log.info({ ...report }, 'manual-source-sync-completed');
        return report;
      });
    return this.track(work, 'manual-source-sync-failed', { synced: 0, failed: [], kept: 0 });
  }

  private async runRequestedSourceSync(
    request: RequestedSourceSync,
  ): Promise<SourceSyncOutcome | undefined> {
    if (this.manualInFlight.has(request.sourceId)) return undefined;
    this.manualInFlight.add(request.sourceId);
    if (!this.engine.markSourceSyncStarted(request)) {
      this.manualInFlight.delete(request.sourceId);
      return undefined;
    }
    try {
      return await this.engine.syncSource(request.sourceId);
    } catch (error: unknown) {
      this.log.error(
        { sourceId: request.sourceId, errorName: errorName(error) },
        'manual-source-sync-source-failed',
      );
      return {
        sourceId: request.sourceId,
        status: 'error',
        fetched: 0,
        kept: 0,
        message: error instanceof Error ? error.message : String(error),
      };
    } finally {
      this.engine.clearSourceSyncRequest(request);
      this.manualInFlight.delete(request.sourceId);
    }
  }

  /**
   * Гасит таймеры и ждёт текущую волну, но не дольше `graceMs`: базу
   * закрывать только после. Возвращает, дождались ли.
   */
  async stop(graceMs = DEFAULT_STOP_GRACE_MS): Promise<{ waveFinished: boolean }> {
    this.stopped = true;
    for (const timer of this.timers.splice(0)) clearInterval(timer);
    if (this.inFlight.size === 0) return { waveFinished: true };
    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), graceMs);
    });
    const outcome = await Promise.race([
      Promise.allSettled(Array.from(this.inFlight)).then(() => 'finished' as const),
      deadline,
    ]);
    if (timer) clearTimeout(timer);
    if (outcome === 'timeout') {
      this.log.warn({ graceMs }, 'maintenance-stop-wave-abandoned');
      return { waveFinished: false };
    }
    return { waveFinished: true };
  }

  private track<T>(work: Promise<T>, failureMessage: string, fallback: T): Promise<T> {
    const tracked = work
      .catch((error: unknown) => {
        this.log.error({ errorName: errorName(error) }, failureMessage);
        return fallback;
      })
      .finally(() => {
        this.inFlight.delete(tracked);
      });
    this.inFlight.add(tracked);
    return tracked;
  }
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'UnknownError';
}
