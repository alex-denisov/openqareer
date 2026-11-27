import type { VacancySourceConfig } from '../domain/unifiedVacancy';
import type { LinkCheckCensus } from '../vacancies/linkLivenessProbe';
import type { LinkedinPoolExecutorReport } from '../linkedinPool/companyPageExecutor';
import type { WorkdayDescriptionReport } from '../vacancies/workdayDescriptions';
import type { HhCatalogTextReport } from '../vacancies/hhCatalogText';
import type { RequestedSourceSync, SourceSyncOutcome } from '../vacancies/multiSourceVacancyEngine';
import type { SelectionLivenessEngine } from './selectionLivenessStep';
import type { RunUnclusteredCatchUp } from './unclusteredCatchUpStep';
import type { StorePassOptions } from '../vacancies/storePassSteps';
import { STORE_PASS_DELAY_MS } from './storePass';

/** Тот же контракт, что у `fastify.log`: объект контекста, потом сообщение. */
export interface MaintenanceLog {
  info(context: Record<string, unknown>, message: string): void;
  warn(context: Record<string, unknown>, message: string): void;
  error(context: Record<string, unknown>, message: string): void;
}

/** Ровно то, что обслуживатель просит у движка — остальное ему не нужно. */
export interface MaintenanceEngine extends SelectionLivenessEngine {
  getSources(): VacancySourceConfig[];
  replanCompany?(companyKey: string): boolean;
  restoreAsync(
    nowMs?: number,
    chunkSize?: number,
    options?: { prune?: boolean; backfill?: boolean },
  ): Promise<{ restored: number }>;
  maintainStoreAsync(
    nowMs?: number,
    shouldStop?: () => boolean,
    options?: StorePassOptions,
  ): Promise<{ backfillWindows: number }>;
  syncSource(sourceId: string): Promise<SourceSyncOutcome>;
  syncDue(nowMs?: number): Promise<SourceSyncOutcome[]>;
  getRequestedSourceSyncs(): RequestedSourceSync[];
  markSourceSyncStarted(request: RequestedSourceSync, startedAt?: string): boolean;
  clearSourceSyncRequest(request: RequestedSourceSync): boolean;
  probeDueLinks(nowMs?: number): Promise<LinkCheckCensus | undefined>;
  probeUnseenEmployerLinks(
    nowMs?: number,
  ): Promise<{ checked: number; gone: number; open: number; unknown: number }>;
  runCatalogMaintenanceStep(chunk?: number): { processed: number; pending: number } | undefined;
  runClusterKeysBackfillStep(chunk?: number): number;
  runDescriptionSkillsStep?(chunk?: number): {
    inspected: number;
    updated: number;
    passFinished: boolean;
  };
  runWorkdayDescriptionStep?(): Promise<WorkdayDescriptionReport>;
  runHhCatalogTextStep?(): Promise<HhCatalogTextReport>;
  runOrphanClusterStep?(chunk?: number): {
    inspected: number;
    removed: number;
    passFinished: boolean;
  };
  runUnclusteredCatchUpStep?: RunUnclusteredCatchUp; // B763: записи пула без кластера
  readonly clusterKeysReady: boolean;
  /** B485: итоги каталога для сводки подборки после сведения пула. */
  refreshCatalogTotals?(observedAt: string): unknown;
  getCatalogTotals?(): { readonly computedAt?: string } | undefined;
  readonly poolSize: number;
  /** B649-4: тот же счёт в своём потоке, для строки памяти раз в минуту. */
  poolSizeInWorker?(): Promise<number>;
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
  readonly titleParseMs: number;
  readonly titleModelMs: number;
  readonly descriptionSkillsMs?: number;
  readonly workdayDescriptionMs?: number;
  readonly hhCatalogTextMs?: number;
  readonly orphanClustersMs?: number;
  readonly unclusteredCatchUpMs?: number;
  readonly linkedinPoolExecutorMs: number;
  readonly recruiterPurgeMs: number;
  /** Через сколько после старта идёт фоновая чистка пула (B759). */
  readonly storePassDelayMs?: number;
}

export interface MaintenanceLinkedinPoolExecutor {
  runStep(): Promise<LinkedinPoolExecutorReport>;
  stop(): Promise<void> | void;
}

/** Шаг смыслового индекса (B267 S2): одна порция разметки пула правилами. */
export interface TitleParseStep {
  step(chunk: number): {
    scanned: number;
    poolRowsScanned: number;
    backfilled: number;
    newKeys: number;
    pruned: number;
    passFinished: boolean;
  };
  countKeys(): number;
}

export const ROLE_LINK_INTERVAL_MS = 60_000;
/** B643-3: размещения компаний — такт раз в 5 с, пока идёт проход. */
export const PLACEMENT_INTERVAL_MS = 5_000;

export interface TitleModelStep {
  run(): Promise<{
    batches: number;
    parsed: number;
    refused: number;
    frozen: number;
    callsToday: number;
    dailyCapReached: boolean;
    ms: number;
  }>;
}

/**
 * Сколько `stop()` ждёт текущую волну. Отмену (B759) слышит только обход hh:
 * он сохраняет курсор по прочитанному и выходит. Опросы других площадок
 * её не слышат, и замер 22.11 показал, что 200 с ожидания уходили впустую.
 * Брошенная волна безопасна: выход 0, базы не закрываются, SQLite сам
 * откатит незавершённую транзакцию.
 */
export const DEFAULT_STOP_GRACE_MS = 60_000;

export const DEFAULT_MAINTENANCE_INTERVALS: MaintenanceIntervals = {
  manualSyncMs: 5 * 1_000,
  syncMs: 5 * 60 * 1_000,
  livenessMs: 15 * 60 * 1_000,
  catalogMs: 1_000,
  reportMs: 60 * 1_000,
  titleParseMs: 5 * 1_000,
  titleModelMs: 30 * 1_000,
  descriptionSkillsMs: 10 * 1_000,
  workdayDescriptionMs: 10 * 1_000,
  hhCatalogTextMs: 3 * 1_000,
  orphanClustersMs: 2 * 1_000,
  unclusteredCatchUpMs: 2 * 1_000,
  linkedinPoolExecutorMs: 30 * 1_000,
  recruiterPurgeMs: 24 * 60 * 60 * 1_000,
  storePassDelayMs: STORE_PASS_DELAY_MS,
};

/** Ключей индекса за шаг разметки: окно O(chunk), одна короткая транзакция. */
export const TITLE_PARSE_STEP_CHUNK = 500;
export const TITLE_PARSE_PROGRESS_INTERVAL_MS = 5 * 60 * 1_000;
/** Сколько тик может проходить уже размеченные окна подряд. */
export const TITLE_PARSE_IDLE_BUDGET_MS = 300;
/** Как часто таймер проверяет, не пора ли пересчитать итоги каталога (B510). */
export const CATALOG_TOTALS_TICK_MS = 60 * 1_000;
/** Столько строк проекции каталога за один такт: одна короткая транзакция. */
export const CATALOG_STEP_CHUNK = 500;
/** Кластеров за один шаг заполнения ключей: ~5 000 строк ключей в транзакции. */
export const CLUSTER_KEYS_STEP_CHUNK = 500;
/** Строк описаний за один шаг извлечения навыков: короткая транзакция (B307). */
export const DESCRIPTION_SKILLS_STEP_CHUNK = 500;
/** Кластеров за шаг очистки сирот: ~50 мс на VM прода по замеру 21.10 (B535). */
export const ORPHAN_CLUSTERS_STEP_CHUNK = 500;
export const ORPHAN_CLUSTERS_REST_MS = 60 * 60 * 1_000;
