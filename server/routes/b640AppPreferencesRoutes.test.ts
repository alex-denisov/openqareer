import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { createB640Harness } from '../testHelpers/b640VacancyHarness';

const URL = '/api/v1/candidate/b640/app-preferences';
type User = 'flagged.test' | 'other.test' | 'plain.test';
const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});

async function setup() {
  const harness = await createB640Harness({ pool: () => [] });
  closers.push(harness.close);
  const put = (payload: unknown, user?: User) =>
    harness.app.inject({
      method: 'PUT',
      url: URL,
      payload: payload as object,
      headers: user ? { authorization: `Bearer ${harness.tokens[user]}` } : {},
    });
  return { ...harness, put };
}

describe('B593: настройки приложения кабинета', () => {
  it('answers 404 without a session or the flag', async () => {
    const { get, put } = await setup();
    expect((await get(URL)).statusCode).toBe(404);
    expect((await get(URL, 'plain.test')).statusCode).toBe(404);
    expect((await put({ theme: 'dark' }, 'plain.test')).statusCode).toBe(404);
  });

  it('is empty until chosen', async () => {
    const { get } = await setup();
    expect((await get(URL, 'flagged.test')).json().data).toEqual({ theme: null, moneyCurrency: null });
  });

  it('saves theme and money currency separately, scoped to the session candidate', async () => {
    const { get, put } = await setup();
    expect((await put({ theme: 'dark' }, 'flagged.test')).json().data).toEqual({ theme: 'dark', moneyCurrency: null });
    expect((await put({ moneyCurrency: 'USD' }, 'flagged.test')).json().data).toEqual({ theme: 'dark', moneyCurrency: 'USD' });
    expect((await get(URL, 'flagged.test')).json().data).toEqual({ theme: 'dark', moneyCurrency: 'USD' });
    expect((await get(URL, 'other.test')).json().data).toEqual({ theme: null, moneyCurrency: null });
  });

  it('erasing the candidate removes the row', async () => {
    const { put, candidates, candidateIds, databasePath } = await setup();
    await put({ moneyCurrency: 'EUR' }, 'flagged.test');
    expect(candidates.deleteCandidate(candidateIds['flagged.test'])).toBe(true);
    const db = new DatabaseSync(databasePath);
    const left = db.prepare('SELECT COUNT(*) AS n FROM candidate_app_preferences').get() as { n: number };
    db.close();
    expect(left.n).toBe(0);
  });

  it('refuses unknown values and fields', async () => {
    const { put } = await setup();
    expect((await put({ moneyCurrency: 'AED' }, 'flagged.test')).json().data.moneyCurrency).toBe('AED');
    for (const body of [{ theme: 'neon' }, { moneyCurrency: 'GBP' }, { theme: 'dark', candidateId: 'x' }, {}]) {
      expect((await put(body, 'flagged.test')).statusCode).toBe(400);
    }
  });
});
