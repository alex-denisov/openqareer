import { describe, expect, it } from 'vitest';
import { STORE_PASS_MIN_GAP_MS, runStorePass, type StorePassDeps } from './storePass';
import type { StorePassMark } from './storePassMark';
import type { StorePassOptions, StorePassProgress } from '../vacancies/storePassSteps';

const NOW = 1_800_000_000_000;

function memoryMark(last: number | null, progress: StorePassProgress | null = null) {
  const state = { last, progress };
  const mark: StorePassMark = {
    lastFinishedMs: () => state.last,
    markFinished: (ms) => {
      state.last = ms;
      state.progress = null;
    },
    progress: () => state.progress,
    saveProgress: (next) => {
      state.progress = next;
    },
  };
  return { state, mark };
}

function deps(
  mark: StorePassMark,
  run: (options: StorePassOptions, stop: () => void) => Promise<void>,
): { deps: StorePassDeps; calls: StorePassOptions[]; messages: string[] } {
  const calls: StorePassOptions[] = [];
  const messages: string[] = [];
  let stopped = false;
  return {
    calls,
    messages,
    deps: {
      maintainStoreAsync: async (_now, _shouldStop, options = {}) => {
        calls.push(options);
        await run(options, () => {
          stopped = true;
        });
        return { backfillWindows: 0 };
      },
      mark,
      stopped: () => stopped,
      now: () => NOW,
      log: {
        info: (_payload, message) => messages.push(message),
        error: (_payload, message) => messages.push(message),
      },
    },
  };
}

describe('runStorePass: проход продолжается после рестарта (B759)', () => {
  it('остановленный проход сохраняет шаг, следующий старт продолжает с него', async () => {
    const { state, mark } = memoryMark(NOW - STORE_PASS_MIN_GAP_MS - 1);
    const first = deps(mark, async (options, stop) => {
      options.onProgress?.({ step: 'clusters', backfillCursor: 0 });
      stop();
    });
    await runStorePass(first.deps);
    expect(state.progress).toEqual({ step: 'clusters', backfillCursor: 0 });
    expect(first.messages).toContain('maintenance-store-pass-stopped');

    const second = deps(mark, async (options) => {
      options.onProgress?.({ step: 'backfill', backfillCursor: 2_000 });
    });
    await runStorePass(second.deps);
    expect(second.calls[0]?.from).toEqual({ step: 'clusters', backfillCursor: 0 });
    expect(second.messages).toContain('maintenance-store-pass-resumed');
    expect(state.progress).toBeNull();
    expect(state.last).toBe(NOW);
  });

  it('незаконченный проход продолжается, даже если отметка свежая', async () => {
    const { mark } = memoryMark(NOW - 1_000, { step: 'backfill', backfillCursor: 8_000 });
    const run = deps(mark, async () => undefined);
    await runStorePass(run.deps);
    expect(run.calls).toHaveLength(1);
    expect(run.calls[0]?.from).toEqual({ step: 'backfill', backfillCursor: 8_000 });
  });

  it('законченный проход не начинается заново до срока таймера', async () => {
    const { mark } = memoryMark(NOW - 1_000);
    const run = deps(mark, async () => undefined);
    await runStorePass(run.deps);
    expect(run.calls).toHaveLength(0);
    expect(run.messages).toEqual(['maintenance-store-pass-skipped']);
  });

  it('новый проход идёт с начала: без from', async () => {
    const { mark } = memoryMark(null);
    const run = deps(mark, async () => undefined);
    await runStorePass(run.deps);
    expect(run.calls[0]?.from).toBeUndefined();
  });
});
