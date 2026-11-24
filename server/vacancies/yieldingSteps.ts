import { setImmediate as yieldToEventLoop } from 'node:timers/promises';
import { syncSection } from '../observability/syncSections';

/** A computation cut at its `yield`s: one piece for a sync caller, slices for an HTTP read. */
export type Steps<R> = Generator<void, R, void>;

const ROWS_PER_STEP = 25;

export function runSteps<R>(steps: Steps<R>): R {
  let step = steps.next();
  while (!step.done) step = steps.next();
  return step.value;
}

interface YieldingOptions {
  readonly sliceMs?: number;
  readonly now?: () => number;
  /** Names a step that holds the loop by itself for the stall log (B770). */
  readonly section?: string;
}

/** Same computation; after each `sliceMs` of work it lets queued requests run. */
export async function runStepsYielding<R>(
  steps: Steps<R>,
  options: YieldingOptions = {},
): Promise<R> {
  const { sliceMs = 20, now = () => performance.now(), section } = options;
  const next = section ? () => syncSection(section, () => steps.next()) : () => steps.next();
  let sliceStart = now();
  let step = next();
  while (!step.done) {
    if (now() - sliceStart >= sliceMs) {
      await yieldToEventLoop();
      sliceStart = now();
    }
    step = next();
  }
  return step.value;
}

export function* mapInSteps<T, R>(
  items: readonly T[],
  map: (item: T) => R,
  rowsPerStep = ROWS_PER_STEP,
): Steps<R[]> {
  const mapped: R[] = [];
  for (const item of items) {
    mapped.push(map(item));
    if (mapped.length % rowsPerStep === 0) yield;
  }
  return mapped;
}

export function* filterInSteps<T>(
  items: readonly T[],
  keep: (item: T) => boolean,
  rowsPerStep = ROWS_PER_STEP,
): Steps<T[]> {
  const kept = yield* mapInSteps(items, keep, rowsPerStep);
  return items.filter((_, index) => kept[index]);
}
