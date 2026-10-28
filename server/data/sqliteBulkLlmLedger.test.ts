import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BulkLlmConfig } from '../providers/bulkLlmConfig';
import { SqliteBulkLlmLedger } from './sqliteBulkLlmLedger';

const limits = { runUsd: 100, dayUsd: 100, monthUsd: 1, perRequestUsd: 0.4 } as BulkLlmConfig;
const call = { runId: 'run', task: 'vacancy-fit', model: 'deepseek/deepseek-v4-flash', provider: 'p' };

describe('потолок фоновой обработки — месячный (B580, решение владельца 29.10)', () => {
  let dir = '';
  afterEach(() => {
    vi.useRealTimers();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  function ledgerAt(iso: string) {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse(iso));
    dir = mkdtempSync(join(tmpdir(), 'bulk-ledger-'));
    return new SqliteBulkLlmLedger(join(dir, 'ledger.db'));
  }

  function spend(ledger: SqliteBulkLlmLedger, usd: number) {
    const id = ledger.reserve(call, limits);
    expect(id).not.toBeNull();
    ledger.settle(id!, { cost: usd, promptTokens: 1, cachedTokens: 0, completionTokens: 1 });
  }

  it('расход прошлого месяца не закрывает новый месяц', () => {
    const ledger = ledgerAt('2026-10-31T12:00:00.000Z');
    spend(ledger, 0.4);
    spend(ledger, 0.4);
    expect(ledger.reserve(call, limits)).toBeNull();
    vi.setSystemTime(Date.parse('2026-11-01T00:05:00.000Z'));
    expect(ledger.reserve(call, limits)).not.toBeNull();
  });

  it('остаток в отчёте считается от начала месяца', () => {
    const ledger = ledgerAt('2026-10-31T12:00:00.000Z');
    spend(ledger, 0.4);
    vi.setSystemTime(Date.parse('2026-11-02T08:00:00.000Z'));
    spend(ledger, 0.25);
    const status = ledger.status(limits);
    expect(status.spentUsd).toBeCloseTo(0.25, 6);
    expect(status.remainingUsd).toBeCloseTo(0.75, 6);
    expect(status.limits?.monthUsd).toBe(1);
  });

  it('фактическая цена чуть выше резерва записывается, а следующий вызов проходит (28.10)', () => {
    const ledger = ledgerAt('2026-10-28T20:50:00.000Z');
    const id = ledger.reserve(call, limits);
    ledger.settle(id!, { cost: 0.4001, promptTokens: 1, cachedTokens: 0, completionTokens: 1 });
    expect(ledger.reserve(call, limits)).not.toBeNull();
    const status = ledger.status(limits);
    expect(status.spentUsd).toBeCloseTo(0.4001, 6);
    expect(status.events.some((event) => event.kind === 'cost_exceeds_reservation')).toBe(true);
  });

  it('фон останавливает только фактический расход месяца у потолка', () => {
    const ledger = ledgerAt('2026-10-28T20:50:00.000Z');
    const id = ledger.reserve(call, limits);
    ledger.settle(id!, { cost: 0.9, promptTokens: 1, cachedTokens: 0, completionTokens: 1 });
    expect(ledger.reserve(call, limits)).toBeNull();
  });
});
