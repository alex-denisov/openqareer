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

/**
 * B776 (прод 23.11): треть секунд задержек шла «без шага» — синхронные таймеры веб-процесса
 * (обновление карт сайта, вакансий, удержание) не были подписаны, и задержку приписывали
 * страницам каталога, которые в это время ждали. Таймер под своим именем; ошибка — в onError.
 */
export function labelledTimer(name: string, run: () => unknown, onError: (error: unknown) => void): () => void {
  return () => {
    backgroundStep(name, async () => run()).catch(onError);
  };
}

/** Шаг в окне задержки и сколько миллисекунд окна он шёл. */
export interface HeldStep {
  readonly name: string;
  readonly overlapMs: number;
}

/**
 * Шаги, которые шли в окне задержки, по перекрытию с окном: длинное первым. Прод 23.11: список
 * имён без длительности назвал 8 шагов в одной задержке 2,2 с — виновника было не отличить.
 */
export function heldBackgroundSteps(windowStart: number, now: number): HeldStep[] {
  const held = [
    ...active.values(),
    ...finished.filter((step) => (step.finishedAt ?? now) >= windowStart && step.startedAt <= now),
  ];
  const byName = new Map<string, number>();
  for (const step of held) {
    const overlap = Math.min(step.finishedAt ?? now, now) - Math.max(step.startedAt, windowStart);
    byName.set(step.name, Math.max(byName.get(step.name) ?? 0, overlap));
  }
  return [...byName.entries()]
    .map(([name, overlap]) => ({ name, overlapMs: Math.max(0, Math.round(overlap)) }))
    .sort((a, b) => b.overlapMs - a.overlapMs)
    .slice(0, MAX_NAMED);
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
