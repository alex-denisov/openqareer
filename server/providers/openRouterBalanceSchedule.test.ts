import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';
import {
  checkOpenRouterBalance,
  readBalanceThreshold,
  type BalanceCheckDeps,
} from './openRouterBalanceSchedule';

const log = { info: vi.fn(), error: vi.fn() };

function credits(total: number, usage: number): typeof fetch {
  return vi.fn(async () =>
    Response.json({ data: { total_credits: total, total_usage: usage } }),
  ) as unknown as typeof fetch;
}

function setup(over: Partial<BalanceCheckDeps> = {}) {
  const database = new DatabaseSync(':memory:');
  const notify = vi.fn(
    async (_config: unknown, _text: string) =>
      ({ status: 'sent', httpStatus: 200, messageId: 1 }) as never,
  );
  const deps: BalanceCheckDeps = {
    database,
    apiKey: 'sk-secret',
    thresholdUsd: 5,
    telegram: {},
    log,
    fetchImpl: credits(41, 38),
    notify,
    now: () => new Date('2026-11-04T10:00:00Z'),
    ...over,
  };
  return { database, notify, deps };
}

describe('openrouter balance alert', () => {
  it('stays silent above the threshold', async () => {
    const { notify, deps } = setup({ fetchImpl: credits(41, 26.39) });
    await checkOpenRouterBalance(deps);
    expect(notify).not.toHaveBeenCalled();
  });

  it('sends once a day, also from a new instance on the same database', async () => {
    const { database, notify, deps } = setup();
    await checkOpenRouterBalance(deps);
    await checkOpenRouterBalance(deps);
    await checkOpenRouterBalance({ ...deps });
    expect(notify).toHaveBeenCalledTimes(1);
    expect(String(notify.mock.calls[0]?.[1])).toContain('$3.00');
    expect(database.prepare('SELECT id FROM bulk_llm_events').all()).toEqual([
      { id: 'openrouter_low_balance:2026-11-04' },
    ]);
  });

  it('sends again on another UTC day', async () => {
    const { notify, deps } = setup();
    await checkOpenRouterBalance(deps);
    await checkOpenRouterBalance({ ...deps, now: () => new Date('2026-11-05T00:00:01Z') });
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it('records the mark when Telegram is disabled', async () => {
    const { notify, deps } = setup();
    notify.mockResolvedValue({ status: 'disabled' } as never);
    await checkOpenRouterBalance(deps);
    await checkOpenRouterBalance(deps);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('does not record the mark when Telegram fails, and retries', async () => {
    const { database, notify, deps } = setup();
    notify.mockResolvedValueOnce({ status: 'failed', reason: 'network' } as never);
    await checkOpenRouterBalance(deps);
    expect(database.prepare('SELECT id FROM bulk_llm_events').all()).toEqual([]);
    await checkOpenRouterBalance(deps);
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it('does not send or throw on a failed or malformed credits response', async () => {
    const broken = [
      vi.fn(async () => new Response('no', { status: 500 })),
      vi.fn(async () => Response.json({ data: {} })),
      vi.fn(async () => {
        throw new Error('offline');
      }),
    ] as unknown as (typeof fetch)[];
    for (const fetchImpl of broken) {
      const { notify, deps } = setup({ fetchImpl });
      await expect(checkOpenRouterBalance(deps)).resolves.toBeUndefined();
      expect(notify).not.toHaveBeenCalled();
    }
    expect(JSON.stringify(log.error.mock.calls)).not.toContain('sk-secret');
  });

  it('reads the threshold from the environment', () => {
    expect(readBalanceThreshold({})).toBe(5);
    expect(readBalanceThreshold({ OPENQAREER_OPENROUTER_BALANCE_ALERT_USD: '8' })).toBe(8);
    expect(readBalanceThreshold({ OPENQAREER_OPENROUTER_BALANCE_ALERT_USD: 'x' })).toBe(5);
  });
});
