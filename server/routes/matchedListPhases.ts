import type { Steps } from '../vacancies/yieldingSteps';

/**
 * B770: холодная сборка подборки — prepareMs 1,6–1,9 с и listMs 1,2–1,6 с, под нагрузкой до
 * 16,6 с. Время шага на стене включает чужие ходы event loop, поэтому каждая фаза считает только
 * своё время внутри шага: так видно, какая фаза дорога сама, а какая ждёт очереди.
 */
export type ListPhasesMs = Readonly<Record<string, number>>;

export interface PhaseTimer {
  /** Те же шаги; время внутри каждого `next()` идёт в фазу `name`. */
  steps<R>(name: string, steps: Steps<R>): Steps<R>;
  /** Синхронная работа целиком в фазу `name`. */
  run<R>(name: string, work: () => R): R;
  read(): ListPhasesMs;
}

const roundMs = (ms: number): number => Number(ms.toFixed(2));

export function createPhaseTimer(now: () => number = () => performance.now()): PhaseTimer {
  const spent = new Map<string, number>();
  const add = (name: string, ms: number): void => {
    spent.set(name, (spent.get(name) ?? 0) + ms);
  };
  return {
    *steps<R>(name: string, steps: Steps<R>): Steps<R> {
      for (;;) {
        const startedAt = now();
        const step = steps.next();
        add(name, now() - startedAt);
        if (step.done) return step.value;
        yield;
      }
    },
    run<R>(name: string, work: () => R): R {
      const startedAt = now();
      try {
        return work();
      } finally {
        add(name, now() - startedAt);
      }
    },
    read: () => Object.fromEntries([...spent].map(([name, ms]) => [name, roundMs(ms)])),
  };
}
