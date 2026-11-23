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
}

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

async function backfill(input: StepInput, control: PruneControl, from: number): Promise<number> {
  const { pool, options, shouldStop } = input;
  let windows = 0;
  let cursor = from;
  while (pool.backfillWindowStep && !shouldStop()) {
    windows += 1;
    const step = pool.backfillWindowStep(options.windowRows, cursor);
    if (step.done) break;
    cursor = step.cursor ?? 0;
    options.onProgress?.({ step: 'backfill', backfillCursor: cursor });
    await pause(control.pauseMs ?? 0);
  }
  return windows;
}

/** Проход с сохранённого шага; каждый законченный шаг отмечается до проверки остановки. */
export async function runStorePassSteps(input: StepInput): Promise<{ backfillWindows: number }> {
  const { pool, options, shouldStop } = input;
  const control = { pauseMs: Math.max(0, options.pauseMs ?? 0), shouldStop };
  const start = STORE_PASS_STEPS.indexOf(options.from?.step ?? 'pool');
  if (start <= 0) {
    if (pool.pruneAsync)
      await pool.pruneAsync(input.knownSourceIds, input.oldestPublishedAt, control);
    else pool.prune(input.knownSourceIds, input.oldestPublishedAt);
    options.onProgress?.({ step: 'clusters', backfillCursor: 0 });
    if (shouldStop()) return { backfillWindows: 0 };
  }
  if (start <= 1) {
    if (pool.pruneClustersBeforeAsync) {
      await pool.pruneClustersBeforeAsync(input.oldestPublishedAt, control);
    } else {
      input.pruneClustersSync();
    }
    options.onProgress?.({ step: 'backfill', backfillCursor: 0 });
    if (shouldStop()) return { backfillWindows: 0 };
  }
  const from = options.from?.step === 'backfill' ? options.from.backfillCursor : 0;
  return { backfillWindows: await backfill(input, control, from) };
}
