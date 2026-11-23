import { PerformanceObserver, performance } from 'node:perf_hooks';

/**
 * B769 (прод 23.11): за 3 часа 438 задержек event loop ≥250 мс без запросов, 395 из них — внутри
 * прохода подбора. Журнал задержки называл только запросы; фоновый шаг и сборка мусора не были видны.
 */
interface Step {
  readonly name: string;
  readonly startedAt: number;
  finishedAt?: number;
}

const MAX_NAMED = 8;
const MAX_FINISHED = 32;
const MAX_GC_ENTRIES = 64;

let nextId = 0;
const active = new Map<number, Step>();
let finished: Step[] = [];

/** Шаг фоновой работы веб-процесса: виден журналу задержек, пока идёт, и до следующего такта. */
export async function backgroundStep<T>(name: string, run: () => Promise<T>): Promise<T> {
  const id = nextId++;
  const step: Step = { name, startedAt: performance.now() };
  active.set(id, step);
  try {
    return await run();
  } finally {
    active.delete(id);
    finished = [...finished, { ...step, finishedAt: performance.now() }].slice(-MAX_FINISHED);
  }
}

/** Шаги, которые шли в окне задержки: идущие и закончившиеся после начала окна. */
export function heldBackgroundSteps(windowStart: number, now: number): string[] {
  const held = [
    ...active.values(),
    ...finished.filter((step) => (step.finishedAt ?? now) >= windowStart && step.startedAt <= now),
  ];
  return [...new Set(held.map((step) => step.name))].slice(0, MAX_NAMED);
}

export function resetBackgroundSteps(): void {
  active.clear();
  finished = [];
}

/** Время сборки мусора в окне задержки, по записям `gc` из perf_hooks. */
export function gcWatch() {
  let entries: { readonly startTime: number; readonly duration: number }[] = [];
  const observer = new PerformanceObserver((list) => {
    const fresh = list.getEntries().map((entry) => ({ startTime: entry.startTime, duration: entry.duration }));
    entries = [...entries, ...fresh].slice(-MAX_GC_ENTRIES);
  });
  return {
    enable: () => observer.observe({ entryTypes: ['gc'] }),
    disable: () => observer.disconnect(),
    msIn: (windowStart: number, now: number): number => {
      const overlap = entries.reduce((sum, entry) => {
        const start = Math.max(entry.startTime, windowStart);
        const end = Math.min(entry.startTime + entry.duration, now);
        return end > start ? sum + (end - start) : sum;
      }, 0);
      return Math.round(overlap);
    },
  };
}
