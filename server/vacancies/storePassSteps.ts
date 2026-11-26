import { retryOnSqliteBusy } from '../data/sqliteBusyRetry';
import type { PruneControl } from './poolPruneBatches';
import type { VacancyPoolStore } from './vacancyPoolStore';

/**
 * Шаги фоновой чистки пула (B759). Выкаты шли каждые ~30 мин, и рестарт начинал
 * проход заново: 23.11 ни один из трёх проходов не дошёл до конца. Законченный шаг
 * и позиция дочитывания сохраняются, следующий старт продолжает с них. Внутри
 * чисток позиция не нужна: удалённое не возвращается, повтор читает только остаток.
 */
export const STORE_PASS_STEPS = ['pool', 'clusters', 'backfill'] as const;
export type StorePassStep = (typeof STORE_PASS_STEPS)[number];

export interface StorePassProgress {
  readonly step: StorePassStep;
  /** `rowid` пула, с которого продолжать дочитывание; для чисток — 0. */
  readonly backfillCursor: number;
}

export interface StorePassOptions {
  readonly pauseMs?: number;
  readonly windowRows?: number;
  /** С какого шага продолжать; без него — с начала. */
  readonly from?: StorePassProgress;
  /** Шаг закончен или окно дочитано: отметить, откуда продолжать. */
  readonly onProgress?: (progress: StorePassProgress) => void;
  /** Паузы перед повтором шага, когда база занята; по умолчанию {@link STORE_PASS_BUSY_DELAYS_MS}. */
  readonly busyDelaysMs?: readonly number[];
}

/**
 * Прод 23.11 05:42Z: проход упал на «database is locked» посреди дочитывания и ждал следующего
 * старта. Фону спешить некуда: окно повторяется с того же курсора с паузами до ~45 с.
 */
export const STORE_PASS_BUSY_DELAYS_MS: readonly number[] = [1_000, 3_000, 10_000, 30_000];

export function isStorePassStep(value: unknown): value is StorePassStep {
  return STORE_PASS_STEPS.includes(value as StorePassStep);
}

interface StepInput {
  readonly pool: VacancyPoolStore;
  readonly knownSourceIds: readonly string[];
  readonly oldestPublishedAt: string;
  readonly shouldStop: () => boolean;
  readonly pruneClustersSync: () => void;
  readonly options: StorePassOptions;
}

const pause = (ms: number) =>
  new Promise((resolve) => (ms > 0 ? setTimeout(resolve, ms) : setImmediate(resolve)));

const busy = (options: StorePassOptions) => ({
  delaysMs: options.busyDelaysMs ?? STORE_PASS_BUSY_DELAYS_MS,
});

function readWindow(input: StepInput, cursor: number) {
  const step = input.pool.backfillWindowStep;
  if (!step) return { done: true };
  return step.call(input.pool, input.options.windowRows, cursor);
}

async function prunePool(input: StepInput, control: PruneControl): Promise<void> {
  const { pool } = input;
  if (pool.pruneAsync)
    await pool.pruneAsync(input.knownSourceIds, input.oldestPublishedAt, control);
  else pool.prune(input.knownSourceIds, input.oldestPublishedAt);
}

async function pruneClusters(input: StepInput, control: PruneControl): Promise<void> {
  if (input.pool.pruneClustersBeforeAsync)
    await input.pool.pruneClustersBeforeAsync(input.oldestPublishedAt, control);
  else input.pruneClustersSync();
}

async function backfill(input: StepInput, control: PruneControl, from: number): Promise<number> {
  const { pool, options, shouldStop } = input;
  let windows = 0;
  let cursor = from;
  while (pool.backfillWindowStep && !shouldStop()) {
    windows += 1;
    const at = cursor;
    const step = await retryOnSqliteBusy(() => readWindow(input, at), busy(options));
    if (step.done) break;
    cursor = step.cursor ?? 0;
    options.onProgress?.({ step: 'backfill', backfillCursor: cursor });
    await pause(control.pauseMs ?? 0);
  }
  return windows;
}

/** Проход с сохранённого шага; каждый законченный шаг отмечается до проверки остановки. */
export async function runStorePassSteps(input: StepInput): Promise<{ backfillWindows: number }> {
  const { options, shouldStop } = input;
  const control = { pauseMs: Math.max(0, options.pauseMs ?? 0), shouldStop };
  const start = STORE_PASS_STEPS.indexOf(options.from?.step ?? 'pool');
  // Чистки повторяются целиком: удалённое не возвращается, повтор читает только остаток.
  if (start <= 0) {
    await retryOnSqliteBusy(() => prunePool(input, control), busy(options));
    options.onProgress?.({ step: 'clusters', backfillCursor: 0 });
    if (shouldStop()) return { backfillWindows: 0 };
  }
  if (start <= 1) {
    await retryOnSqliteBusy(() => pruneClusters(input, control), busy(options));
    options.onProgress?.({ step: 'backfill', backfillCursor: 0 });
    if (shouldStop()) return { backfillWindows: 0 };
  }
  const from = options.from?.step === 'backfill' ? options.from.backfillCursor : 0;
  return { backfillWindows: await backfill(input, control, from) };
}
