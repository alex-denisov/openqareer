import { describe, expect, it } from 'vitest';
import { MemoryGuard, INGEST_PAUSE_RATIO, INGEST_RESUME_RATIO } from './memoryGuard';

const MB = 1024 * 1024;
const LIMIT = 1536 * MB;

function guardAt(usedMb: number[]) {
  let i = 0;
  const guard = new MemoryGuard(() => ({
    heapUsedBytes: usedMb[Math.min(i++, usedMb.length - 1)]! * MB,
    heapLimitBytes: LIMIT,
  }));
  return guard;
}

describe('MemoryGuard (B220)', () => {
  it('ниже порога опросы идут', () => {
    const verdict = guardAt([500]).check();

    expect(verdict.paused).toBe(false);
    expect(verdict.heapUsedMb).toBe(500);
    expect(verdict.heapLimitMb).toBe(1536);
    expect(verdict.usedRatio).toBeCloseTo(500 / 1536, 3);
  });

  it('выше порога опросы приостанавливаются с названной причиной', () => {
    const verdict = guardAt([Math.ceil(1536 * INGEST_PAUSE_RATIO) + 1]).check();

    expect(verdict.paused).toBe(true);
    expect(verdict.reason).toContain('heap');
  });

  it('гистерезис: после паузы опросы возобновляются только ниже нижнего порога', () => {
    const high = Math.ceil(1536 * INGEST_PAUSE_RATIO) + 1;
    const between = Math.ceil((1536 * (INGEST_PAUSE_RATIO + INGEST_RESUME_RATIO)) / 2);
    const low = Math.floor(1536 * INGEST_RESUME_RATIO) - 1;
    const guard = guardAt([high, between, low, between]);

    expect(guard.check().paused).toBe(true);
    // Чуть отпустило, но ещё выше нижнего порога — всё ещё пауза, иначе дребезг.
    expect(guard.check().paused).toBe(true);
    expect(guard.check().paused).toBe(false);
    // Снова между порогами, но пауза не включается: включает только верхний.
    expect(guard.check().paused).toBe(false);
  });

  it('смена состояния помечается: журнал пишет один раз, а не каждый тик', () => {
    const high = Math.ceil(1536 * INGEST_PAUSE_RATIO) + 1;
    const guard = guardAt([high, high, 100]);

    expect(guard.check().changed).toBe(true);
    expect(guard.check().changed).toBe(false);
    expect(guard.check().changed).toBe(true);
  });

  it('нулевой предел кучи не делит на ноль и не блокирует опросы', () => {
    const guard = new MemoryGuard(() => ({ heapUsedBytes: 10 * MB, heapLimitBytes: 0 }));

    expect(guard.check().paused).toBe(false);
  });
});
