import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { BulkLlmConfig } from '../providers/bulkLlmConfig';
import { SqliteBulkLlmLedger } from './sqliteBulkLlmLedger';

const tight = { runUsd: 1, dayUsd: 1, monthUsd: 1, perRequestUsd: 0.4 } as BulkLlmConfig;
const call = { runId: 'run', task: 'vacancy-fit', model: 'deepseek/deepseek-v4-flash', provider: 'openrouter' };
const gemini = { task: 'roleNames', model: 'gemini-3.8-flash' };
const usage = { cost: 5, promptTokens: 10, cachedTokens: 0, completionTokens: 20 };

describe('строки Gemini ведут свой дневной учёт и не входят в бюджет канала (04.11)', () => {
  let dir = '';
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });
  const open = () => {
    dir = mkdtempSync(join(tmpdir(), 'bulk-ledger-'));
    return new SqliteBulkLlmLedger(join(dir, 'ledger.db'));
  };

  it('записанные вызовы Gemini складываются в сумму дня и закрыты сразу', () => {
    const ledger = open();
    expect(ledger.geminiDaySpentUsd()).toBe(0);
    ledger.recordGeminiCall(gemini, usage);
    ledger.recordGeminiCall(gemini, { ...usage, cost: 0.5 });
    expect(ledger.geminiDaySpentUsd()).toBeCloseTo(5.5, 6);
  });

  it('$5 Gemini не закрывают день, прогон и месяц канала OpenRouter и не пишут перерасход', () => {
    const ledger = open();
    ledger.recordGeminiCall(gemini, usage);
    expect(ledger.reserve(call, tight)).not.toBeNull();
    const status = ledger.status(tight);
    expect(status.spentUsd).toBe(0);
    expect(status.dayRemainingUsd).toBeCloseTo(0.6, 6);
    expect(status.events).toEqual([]);
  });

  it('вызовы OpenRouter не попадают в сумму Gemini', () => {
    const ledger = open();
    const id = ledger.reserve(call, tight);
    ledger.settle(id!, { cost: 0.2, promptTokens: 1, cachedTokens: 0, completionTokens: 1 });
    expect(ledger.geminiDaySpentUsd()).toBe(0);
  });
});
