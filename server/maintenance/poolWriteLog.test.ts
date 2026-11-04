import { describe, expect, it } from 'vitest';
import { createJsonLineLog } from './jsonLineLog';
import { logPoolWrites } from './poolWriteLog';

describe('logPoolWrites (PRB-043 срез 2)', () => {
  function capture() {
    const lines: Array<Record<string, unknown>> = [];
    const log = createJsonLineLog((line) => lines.push(JSON.parse(line)), {});
    return { lines, observe: logPoolWrites(log) };
  }

  it('пишет итог прохода очистки: сколько снято, самая долгая транзакция и время поиска', () => {
    const { lines, observe } = capture();
    observe({
      kind: 'prune',
      scope: 'pool',
      removed: 1000,
      transactions: 11,
      maxTransactionMs: 42.4,
      readMs: 4470.6,
      totalMs: 4900.2,
    });
    expect(lines).toEqual([
      expect.objectContaining({
        level: 30,
        msg: 'pool-pruned',
        scope: 'pool',
        removed: 1000,
        transactions: 11,
        maxTransactionMs: 42,
        readMs: 4471,
        totalMs: 4900,
      }),
    ]);
  });

  it('пишет итог замены среза одной строкой с числом транзакций и самой долгой', () => {
    const { lines, observe } = capture();
    observe({
      kind: 'slice',
      operation: 'replace',
      sourceId: 'hh',
      upserted: 1200,
      removed: 37,
      transactions: 6,
      maxTransactionMs: 412.6,
      totalMs: 1980.2,
    });
    expect(lines).toEqual([
      expect.objectContaining({
        level: 30,
        msg: 'pool-slice-written',
        sourceId: 'hh',
        transactions: 6,
        maxTransactionMs: 413,
        totalMs: 1980,
      }),
    ]);
  });

  it('предупреждает о транзакции дольше секунды и молчит о быстрой', () => {
    const { lines, observe } = capture();
    observe({
      kind: 'transaction',
      operation: 'upsert',
      sourceId: 'hh',
      rows: 250,
      durationMs: 120,
      lockWaitMs: 0,
    });
    observe({
      kind: 'transaction',
      operation: 'remove',
      sourceId: 'hh',
      rows: 250,
      durationMs: 1400,
      lockWaitMs: 1300,
    });
    expect(lines).toEqual([
      expect.objectContaining({
        level: 40,
        msg: 'pool-write-slow',
        operation: 'remove',
        durationMs: 1400,
        lockWaitMs: 1300,
      }),
    ]);
  });
});
