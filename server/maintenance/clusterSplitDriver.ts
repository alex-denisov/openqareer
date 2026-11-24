import { statSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { splitClustersStep, type ClusterSplitStepResult } from '../vacancies/clusterSplitStep';

/**
 * B752: водитель разбиения склеенных кластеров в процессе обслуживания.
 * Выключен по умолчанию (`CLUSTER_SPLIT_ENABLED`). Между шагами — пауза
 * таймером и `wal_checkpoint(TRUNCATE)`; остановка при задержке цикла
 * событий, памяти процесса, росте WAL или просьбе шага.
 */

export interface ClusterSplitConfig {
  readonly enabled: boolean;
  readonly pauseMs: number;
  readonly walLimitBytes: number;
}

const DEFAULT_PAUSE_MS = 2_000;
const DEFAULT_WAL_LIMIT_BYTES = 1024 ** 3;
/** Старт через минуту после готовности: восстановление и первая волна идут без него. */
export const CLUSTER_SPLIT_START_DELAY_MS = 60_000;
export const CLUSTER_SPLIT_LAG_P99_LIMIT_MS = 200;
export const CLUSTER_SPLIT_RSS_LIMIT_BYTES = 1.5 * 1024 ** 3;

function nonNegativeInteger(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

export function readClusterSplitConfig(
  env: Readonly<Record<string, string | undefined>>,
): ClusterSplitConfig {
  return {
    enabled: env.CLUSTER_SPLIT_ENABLED === '1' || env.CLUSTER_SPLIT_ENABLED === 'true',
    pauseMs: nonNegativeInteger(env.CLUSTER_SPLIT_PAUSE_MS, DEFAULT_PAUSE_MS),
    walLimitBytes: nonNegativeInteger(env.CLUSTER_SPLIT_WAL_LIMIT_BYTES, DEFAULT_WAL_LIMIT_BYTES),
  };
}

interface DriverLog {
  info(fields: Record<string, unknown>, message: string): void;
  warn(fields: Record<string, unknown>, message: string): void;
}

export interface ClusterSplitDriverOptions {
  readonly config: ClusterSplitConfig;
  readonly step: () => ClusterSplitStepResult;
  /**
   * Сбросить копию кластеров движка в памяти: старые пути держат весь пул и
   * могли бы записать основателя назад со снятыми источниками.
   */
  readonly dropClusterSnapshot: () => void;
  readonly checkpoint: () => void;
  readonly sleep: (ms: number) => Promise<void>;
  readonly log: DriverLog;
  readonly lagP99Ms: () => number;
  readonly rssBytes: () => number;
  readonly walBytes: () => number;
  readonly isStopped: () => boolean;
}

export interface ClusterSplitDriverReport {
  readonly steps: number;
  readonly reason: string;
}

function pauseReason(options: ClusterSplitDriverOptions, result: ClusterSplitStepResult) {
  if (result.stop) return 'step_stop';
  if (options.rssBytes() > CLUSTER_SPLIT_RSS_LIMIT_BYTES) return 'rss';
  if (options.walBytes() > options.config.walLimitBytes) return 'wal';
  return undefined;
}

export async function runClusterSplitDriver(
  options: ClusterSplitDriverOptions,
): Promise<ClusterSplitDriverReport> {
  if (!options.config.enabled) return { steps: 0, reason: 'disabled' };
  let steps = 0;
  let maxWriteMs = 0;
  let pagesUnresolved = 0;
  const paused = (reason: string, stepId: string | null) => {
    options.log.warn(
      { steps, reason, stepId, maxWriteMs, pagesUnresolved },
      'cluster_split_paused',
    );
    return { steps, reason };
  };
  while (!options.isStopped()) {
    const result = options.step();
    steps += 1;
    maxWriteMs = Math.max(maxWriteMs, result.writeMs);
    pagesUnresolved += result.pages.unresolved;
    options.dropClusterSnapshot();
    options.checkpoint();
    if (result.completed) {
      options.log.info({ steps, maxWriteMs, pagesUnresolved }, 'cluster_split_completed');
      return { steps, reason: 'completed' };
    }
    // Задержка цикла за сам шаг (сведение кусков большого кластера — секунды процессора,
    // без блокировки базы) сторожа не останавливает: он судит по паузе между шагами.
    options.lagP99Ms();
    const reason = pauseReason(options, result);
    if (reason) return paused(reason, result.stepId);
    await options.sleep(options.config.pauseMs);
    if (options.lagP99Ms() > CLUSTER_SPLIT_LAG_P99_LIMIT_MS) {
      return paused('event_loop_lag', result.stepId);
    }
  }
  return { steps, reason: 'stopped' };
}

function fileSize(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

/** Боевые пробы: своя гистограмма задержки, RSS процесса, размер `-wal` файла базы. */
export function startClusterSplit(input: {
  readonly db: DatabaseSync;
  readonly databasePath: string;
  readonly config: ClusterSplitConfig;
  readonly log: DriverLog;
  readonly isStopped: () => boolean;
  readonly dropClusterSnapshot: () => void;
}): Promise<ClusterSplitDriverReport> {
  const histogram = monitorEventLoopDelay({ resolution: 20 });
  histogram.enable();
  const logStep = (event: string, fields: Record<string, unknown>) => input.log.info(fields, event);
  return runClusterSplitDriver({
    config: input.config,
    step: () => splitClustersStep(input.db, { log: logStep }),
    dropClusterSnapshot: input.dropClusterSnapshot,
    checkpoint: () => input.db.exec('PRAGMA wal_checkpoint(TRUNCATE)'),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    log: input.log,
    lagP99Ms: () => {
      const p99 = histogram.percentile(99) / 1e6;
      histogram.reset();
      return p99;
    },
    rssBytes: () => process.memoryUsage().rss,
    walBytes: () => fileSize(`${input.databasePath}-wal`),
    isStopped: input.isStopped,
  }).finally(() => histogram.disable());
}
