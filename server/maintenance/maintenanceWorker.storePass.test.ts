import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_STOP_GRACE_MS,
  MaintenanceWorker,
  STORE_PASS_MIN_GAP_MS,
  type MaintenanceLog,
} from './maintenanceWorker';

function silentLog(): MaintenanceLog & { entries: Array<{ level: string; msg: string }> } {
  const entries: Array<{ level: string; msg: string }> = [];
  const push = (level: string) => (_: unknown, msg: string) => {
    entries.push({ level, msg });
  };
  return { entries, info: push('info'), warn: push('warn'), error: push('error') };
}

type StoreCall = {
  shouldStop: (() => boolean) | undefined;
  pauseMs: number | undefined;
  windowRows?: number | undefined;
};

function engineWith(
  maintainStoreAsync: (
    nowMs?: number,
    shouldStop?: () => boolean,
    options?: { pauseMs?: number; windowRows?: number },
  ) => Promise<{ backfillWindows: number }>,
) {
  return {
    getSources: () => [{ id: 'src' }],
    restoreAsync: async () => ({ restored: 1 }),
    maintainStoreAsync,
    runClusterKeysBackfillStep: () => 0,
    clusterKeysReady: true,
    poolSize: 1,
  } as unknown as ConstructorParameters<typeof MaintenanceWorker>[0]['engine'];
}

function markAt(lastMs: number | null) {
  const marks: number[] = [];
  return {
    marks,
    storePassMark: {
      lastFinishedMs: () => lastMs,
      markFinished: (ms: number) => {
        marks.push(ms);
      },
    },
  };
}

/** The worker under test runs only the store pass: every other tick is far away. */
const ONLY_STORE_PASS = { storePassDelayMs: 1_000 };

function startOnlyStorePass(worker: MaintenanceWorker): void {
  // Keep the other timers from running: the store pass is the only thing measured.
  vi.spyOn(worker, 'runSyncWave').mockResolvedValue({ synced: 0, failed: [], kept: 0 });
  vi.spyOn(worker, 'runManualSyncWave').mockResolvedValue(undefined as never);
  vi.spyOn(worker, 'refreshCatalogTotals').mockReturnValue(undefined);
  worker.start();
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('MaintenanceWorker · чистка пула в фоне (B759)', () => {
  it('restore не чистит пул: волны стартуют без ожидания чистки', async () => {
    const calls: StoreCall[] = [];
    const worker = new MaintenanceWorker({
      engine: engineWith(async (_now, shouldStop, options) => {
        calls.push({ shouldStop, pauseMs: options?.pauseMs });
        return { backfillWindows: 0 };
      }),
      log: silentLog(),
    });
    await expect(worker.restore()).resolves.toEqual({ restored: 1 });
    expect(calls).toEqual([]);
  });

  it('после старта чистка идёт сама, с паузами, и ставит отметку', async () => {
    vi.useFakeTimers({ now: Date.parse('2026-11-22T12:00:00Z') });
    const calls: StoreCall[] = [];
    const log = silentLog();
    const { marks, storePassMark } = markAt(null);
    const worker = new MaintenanceWorker({
      engine: engineWith(async (_now, shouldStop, options) => {
        calls.push({ shouldStop, pauseMs: options?.pauseMs, windowRows: options?.windowRows });
        return { backfillWindows: 2 };
      }),
      log,
      storePassMark,
      intervals: ONLY_STORE_PASS,
    });
    await worker.restore();
    startOnlyStorePass(worker);
    expect(calls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(calls).toHaveLength(1);
    // B759 замер 22.11: 250 мс давали stalls в 1,5–2 раза выше обычного — 1 с и окна меньше.
    expect(calls[0]?.pauseMs).toBe(1_000);
    expect(calls[0]?.windowRows).toBe(2_000);
    expect(calls[0]?.shouldStop?.()).toBe(false);
    expect(marks).toEqual([Date.parse('2026-11-22T12:00:01Z')]);
    expect(log.entries.some((entry) => entry.msg === 'maintenance-store-pass')).toBe(true);
    await worker.stop();
  });

  it('свежая отметка — чистка пропускается: частые рестарты её не повторяют', async () => {
    vi.useFakeTimers({ now: Date.parse('2026-11-22T12:00:00Z') });
    const calls: StoreCall[] = [];
    const log = silentLog();
    const { marks, storePassMark } = markAt(Date.now() - STORE_PASS_MIN_GAP_MS + 60_000);
    const worker = new MaintenanceWorker({
      engine: engineWith(async (_now, shouldStop, options) => {
        calls.push({ shouldStop, pauseMs: options?.pauseMs });
        return { backfillWindows: 0 };
      }),
      log,
      storePassMark,
      intervals: ONLY_STORE_PASS,
    });
    await worker.restore();
    startOnlyStorePass(worker);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(calls).toEqual([]);
    expect(marks).toEqual([]);
    expect(log.entries.some((entry) => entry.msg === 'maintenance-store-pass-skipped')).toBe(true);
    await worker.stop();
  });

  it('stop во время чистки: она прерывается, stop её дожидается, отметки нет', async () => {
    vi.useFakeTimers({ now: Date.parse('2026-11-22T12:00:00Z') });
    const log = silentLog();
    const { marks, storePassMark } = markAt(null);
    let release: () => void = () => undefined;
    const worker = new MaintenanceWorker({
      engine: engineWith(
        (_now, shouldStop) =>
          new Promise((resolve, reject) => {
            release = () =>
              shouldStop?.() ? reject(new Error('stopped')) : resolve({ backfillWindows: 0 });
          }),
      ),
      log,
      storePassMark,
      intervals: ONLY_STORE_PASS,
    });
    await worker.restore();
    startOnlyStorePass(worker);
    await vi.advanceTimersByTimeAsync(1_000);
    const stopping = worker.stop(5_000);
    release();
    await expect(stopping).resolves.toEqual({ waveFinished: true });
    expect(marks).toEqual([]);
    expect(
      log.entries
        .filter((entry) => entry.msg.startsWith('maintenance-store-pass'))
        .map((entry) => entry.msg),
    ).toEqual(['maintenance-store-pass-stopped']);
  });

  it('сбой чистки не роняет обслуживание и не ставит отметку', async () => {
    vi.useFakeTimers({ now: Date.parse('2026-11-22T12:00:00Z') });
    const log = silentLog();
    const { marks, storePassMark } = markAt(null);
    const worker = new MaintenanceWorker({
      engine: engineWith(async () => {
        throw new Error('disk');
      }),
      log,
      storePassMark,
      intervals: ONLY_STORE_PASS,
    });
    await worker.restore();
    startOnlyStorePass(worker);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(log.entries.some((entry) => entry.msg === 'maintenance-store-pass-failed')).toBe(true);
    expect(marks).toEqual([]);
    await worker.stop();
  });
});

describe('MaintenanceWorker · срок остановки (B759)', () => {
  it('ждёт волну не дольше 60 с: отмену слышит только обход hh, дольше ждать незачем', () => {
    expect(DEFAULT_STOP_GRACE_MS).toBe(60_000);
  });
});
