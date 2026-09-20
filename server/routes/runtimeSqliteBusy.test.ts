import { describe, expect, it } from 'vitest';
import { isSqliteBusy } from './runtime';

// PRB-043: три входа подряд падали в 500 через 5 с — SQLITE_BUSY за
// транзакцией обслуживателя. Такой отказ — 503 с честной причиной.
describe('isSqliteBusy', () => {
  it('recognises node:sqlite SQLITE_BUSY by errcode', () => {
    const error = Object.assign(new Error('database is locked'), {
      code: 'ERR_SQLITE_ERROR',
      errcode: 5,
      errstr: 'database is locked',
    });
    expect(isSqliteBusy(error)).toBe(true);
  });

  it('does not treat other sqlite errors as busy', () => {
    const error = Object.assign(new Error('UNIQUE constraint failed'), {
      code: 'ERR_SQLITE_ERROR',
      errcode: 19,
    });
    expect(isSqliteBusy(error)).toBe(false);
    expect(isSqliteBusy(new Error('database is locked'))).toBe(false);
  });
});
