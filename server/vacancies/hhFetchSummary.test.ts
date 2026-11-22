import { describe, expect, it, vi } from 'vitest';
import { createHhFetchSummary } from './hhFetchSummary';

const ok = (totalMs: number, lagMs = 0, freshConnection = false) => ({
  status: 200,
  totalMs,
  headersMs: totalMs,
  bodyMs: 0,
  lagMs,
  freshConnection,
});

describe('hh fetch summary (B756)', () => {
  it('every failure is a warn line of its own', () => {
    const log = { info: vi.fn(), warn: vi.fn() };
    const summary = createHhFetchSummary(log);
    const failure = {
      status: 0,
      totalMs: 30_000,
      lagMs: 5,
      freshConnection: false,
      failure: 'TimeoutError',
    };
    summary.record(failure);
    expect(log.warn).toHaveBeenCalledWith(failure, 'hh_fetch');
    expect(log.info).not.toHaveBeenCalled();
  });

  it('answers are folded into one line per flush: count, p50/p95, max lag, fresh connections', () => {
    const log = { info: vi.fn(), warn: vi.fn() };
    const summary = createHhFetchSummary(log);
    for (let ms = 100; ms <= 2_000; ms += 100)
      summary.record(ok(ms, ms === 700 ? 160 : 3, ms === 100));
    summary.record({ ...ok(900), status: 429 });
    summary.flush();
    expect(log.info).toHaveBeenCalledTimes(1);
    expect(log.info).toHaveBeenCalledWith(
      {
        count: 21,
        statuses: { '200': 20, '429': 1 },
        p50TotalMs: 1_000,
        p95TotalMs: 1_900,
        maxLagMs: 160,
        freshConnections: 1,
      },
      'hh_fetch_summary',
    );
    summary.flush();
    expect(log.info).toHaveBeenCalledTimes(1);
  });
});
