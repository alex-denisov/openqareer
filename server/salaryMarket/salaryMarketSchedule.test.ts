import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { scheduleSalaryMarketSnapshots } from './salaryMarketSchedule';
import { readSalaryMarketSnapshot } from './salaryMarketSnapshot';

afterEach(() => vi.useRealTimers());

describe('salary snapshot maintenance schedule', () => {
  it('writes a real catalog snapshot after startup and stops its timers', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-23T00:00:00Z'));
    const db = new DatabaseSync(':memory:');
    db.exec(
      `CREATE TABLE catalog_entries (cluster_id TEXT PRIMARY KEY, role_slug TEXT, role_label TEXT, skills_json TEXT, published_ms INTEGER, status TEXT)`,
    );
    db.prepare('INSERT INTO catalog_entries VALUES (?, ?, ?, ?, ?, ?)').run(
      'a',
      'analyst',
      'Analyst',
      '["SQL"]',
      Date.now(),
      'active',
    );
    const log = { info: vi.fn(), error: vi.fn() };
    const stop = scheduleSalaryMarketSnapshots(db, log);
    expect(readSalaryMarketSnapshot(db, 'analyst')).toBeNull();
    vi.advanceTimersByTime(4 * 60_000);
    expect(readSalaryMarketSnapshot(db, 'analyst')?.skills).toEqual([
      { name: 'SQL', count: 1, frequency: 100 },
    ]);
    expect(log.info).toHaveBeenCalledOnce();
    stop();
    vi.advanceTimersByTime(24 * 60 * 60_000);
    expect(log.info).toHaveBeenCalledOnce();
    db.close();
  });
  it('reports a failed projection without publishing fabricated data', () => {
    vi.useFakeTimers();
    const db = new DatabaseSync(':memory:');
    const log = { info: vi.fn(), error: vi.fn() };
    const stop = scheduleSalaryMarketSnapshots(db, log);
    vi.advanceTimersByTime(4 * 60_000);
    expect(log.error).toHaveBeenCalledOnce();
    expect(readSalaryMarketSnapshot(db, 'analyst')).toBeNull();
    stop();
    db.close();
  });
});
