import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { calendarMonthPeriod, TARIFF_QUOTAS } from '../billing/tariffQuotas';
import { createB640Harness } from '../testHelpers/b640VacancyHarness';

const URL = '/api/v1/candidate/b640/application-quota';
const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});

async function setup(billing = true) {
  const harness = await createB640Harness({ pool: () => [], billing });
  closers.push(harness.close);
  // Сеянные аккаунты тестовые (без квот); здесь нужны обычные.
  const database = new DatabaseSync(harness.databasePath);
  database.exec('UPDATE users SET is_test = 0');
  database.close();
  return harness;
}

function seedUsed(databasePath: string, candidateId: string, count: number, startedAt: string) {
  const database = new DatabaseSync(databasePath);
  const insert = database.prepare(
    `INSERT INTO billing_quota_events (candidate_id, quota_key, period_started_at, unit_key, created_at)
     VALUES (?, 'applications', ?, ?, ?)`,
  );
  for (let index = 0; index < count; index += 1) insert.run(candidateId, startedAt, `seed-${index}`, startedAt);
  database.close();
}

describe('GET b640/application-quota', () => {
  it('answers 404 without a session or the flag', async () => {
    const { get } = await setup();
    expect((await get(URL)).statusCode).toBe(404);
    expect((await get(URL, 'plain.test')).statusCode).toBe(404);
  });

  it('returns plan, limit, used, remaining and the next period start', async () => {
    const { get, databasePath, candidateIds } = await setup();
    const period = calendarMonthPeriod(new Date().toISOString());
    seedUsed(databasePath, candidateIds['flagged.test'], 7, period.startedAt);
    const response = await get(URL, 'flagged.test');
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual({
      plan: 'free',
      limit: TARIFF_QUOTAS.free.applications,
      used: 7,
      remaining: TARIFF_QUOTAS.free.applications - 7,
      renewsAt: period.endsAt,
    });
  });

  it('does not spend the quota by reading it', async () => {
    const { get, databasePath } = await setup();
    await get(URL, 'flagged.test');
    await get(URL, 'flagged.test');
    const database = new DatabaseSync(databasePath);
    const { count } = database.prepare('SELECT COUNT(*) AS count FROM billing_quota_events').get() as { count: number };
    database.close();
    expect(count).toBe(0);
  });

  it('counts only the current period: last month does not count', async () => {
    const { get, databasePath, candidateIds } = await setup();
    const period = calendarMonthPeriod(new Date().toISOString());
    const previous = calendarMonthPeriod(new Date(Date.parse(period.startedAt) - 1).toISOString());
    seedUsed(databasePath, candidateIds['flagged.test'], 5, previous.startedAt);
    const data = (await get(URL, 'flagged.test')).json().data;
    expect(data).toMatchObject({ used: 0, remaining: TARIFF_QUOTAS.free.applications });
  });

  it('remaining stops at zero past the limit', async () => {
    const { get, databasePath, candidateIds } = await setup();
    const period = calendarMonthPeriod(new Date().toISOString());
    seedUsed(databasePath, candidateIds['flagged.test'], TARIFF_QUOTAS.free.applications + 3, period.startedAt);
    expect((await get(URL, 'flagged.test')).json().data.remaining).toBe(0);
  });

  it('has no limit when billing is off or the account is exempt from quotas', async () => {
    const off = await setup(false);
    expect((await off.get(URL, 'flagged.test')).json().data).toMatchObject({ limit: null, remaining: null });
    const on = await setup(true);
    const database = new DatabaseSync(on.databasePath);
    database.exec("UPDATE users SET is_test = 1 WHERE username = 'flagged.test'");
    database.close();
    expect((await on.get(URL, 'flagged.test')).json().data).toMatchObject({ limit: null, remaining: null });
  });
});
