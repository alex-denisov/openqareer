import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { createB640Harness, poolItem, type PoolRow } from '../testHelpers/b640VacancyHarness';
import { forgetMatchedListsForTests } from './matchedVacancyList';

const NEW = '/api/v1/candidate/b640/matched-vacancies';
const OLD = '/api/v1/candidate/matched-vacancies';
const SORTS = ['role', 'company', 'location', 'format', 'date', 'money', 'fit'];
const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  forgetMatchedListsForTests();
  for (const close of closers.splice(0)) await close();
});

const ROWS: PoolRow[] = [
  { id: 'cluster-1', title: 'Яблоко', company: 'Бета', location: 'Москва', observedAt: '2026-10-03T00:00:00.000Z', salaryFrom: 300_000 },
  { id: 'cluster-2', title: 'арбуз', company: 'Альфа', location: 'Санкт-Петербург', observedAt: '2026-10-01T00:00:00.000Z', salaryFrom: 100_000 },
  { id: 'cluster-3', title: 'Банан', company: 'Гамма', isRemote: true, salaryFrom: 200_000 },
  { id: 'cluster-4', title: 'Яблоко', company: 'Дельта', location: 'Казань' },
];
const POOL = ROWS.map(poolItem);

const workspace = (by: 'fit' | 'money', dir: 'desc' | 'asc') => ({
  resumeText: '', resumeSource: 'text' as const, targetDirection: '', regions: [],
  currentSituation: '', constraints: '', urgency: 'exploring' as const, vacancySort: { by, dir },
});

async function setup(saved: { by: 'fit' | 'money'; dir: 'desc' | 'asc' } = { by: 'fit', dir: 'desc' }) {
  const lines: string[] = [];
  const harness = await createB640Harness({ pool: () => POOL, logLines: lines });
  closers.push(harness.close);
  const id = harness.candidateIds['flagged.test'];
  harness.candidates.saveCandidateWorkspace(id, workspace(saved.by, saved.dir));
  const sealedRow = () => {
    const database = new DatabaseSync(harness.databasePath, { readOnly: true });
    try {
      return database.prepare('SELECT candidate_id, built_at, cipher FROM sealed_matched_lists WHERE candidate_id = ?').get(id);
    } finally {
      database.close();
    }
  };
  const ids = (body: string): string[] => JSON.parse(body).data.map((r: { cluster: { id: string } }) => r.cluster.id);
  const user = 'flagged.test' as const;
  const lastServed = (): unknown =>
    lines.map((line) => JSON.parse(line)).filter((line) => line.msg === 'matched-vacancies-timing').at(-1)?.listServed;
  return { ...harness, lastServed, id, sealedRow, ids, user };
}

const within = <T,>(work: Promise<T>, ms: number, what: string): Promise<T> =>
  Promise.race([work, new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${what}: no answer in ${ms} ms (cold read)`)), ms))]);

describe('B674: the new route leaves what the old route reads', () => {
  it('keeps the sealed row byte for byte and the remembered sort, for every sort both ways', async () => {
    const h = await setup();
    expect((await h.get(OLD, h.user)).statusCode).toBe(200);
    const before = h.sealedRow();
    expect(before).toBeTruthy();
    for (const sort of SORTS) {
      for (const direction of ['asc', 'desc']) {
        expect((await h.get(`${NEW}?sort=${sort}&direction=${direction}`, h.user)).statusCode).toBe(200);
      }
    }
    expect(h.sealedRow()).toEqual(before);
    expect(h.candidates.getCandidateWorkspace(h.id)?.vacancySort).toEqual({ by: 'fit', dir: 'desc' });
  });

  it('lets the old route answer from the sealed list, same ids, after the new one', async () => {
    const h = await setup();
    const first = h.ids((await h.get(OLD, h.user)).body);
    for (const sort of SORTS) await h.get(`${NEW}?sort=${sort}&direction=asc`, h.user);
    forgetMatchedListsForTests();
    h.hangPool(true);
    const again = await within(h.get(OLD, h.user), 3000, 'old route');
    expect(h.ids(again.body)).toEqual(first);
    expect(h.lastServed()).toBe('sealed');
  });

  it('the old route does not break the order of the new one', async () => {
    const h = await setup();
    const query = `${NEW}?sort=company&direction=asc`;
    const first = h.ids((await h.get(query, h.user)).body);
    await h.get(OLD, h.user);
    await h.get(`${OLD}?sort=money&dir=asc`, h.user);
    expect(h.ids((await h.get(query, h.user)).body)).toEqual(first);
  });

  it('orders by fit for an account that remembered money', async () => {
    const fitAccount = await setup({ by: 'fit', dir: 'desc' });
    const expected = fitAccount.ids((await fitAccount.get(`${NEW}?sort=fit`, fitAccount.user)).body);
    const money = await setup({ by: 'money', dir: 'desc' });
    const byFit = money.ids((await money.get(`${NEW}?sort=fit`, money.user)).body);
    expect(byFit).toEqual(expected);
    expect(money.candidates.getCandidateWorkspace(money.id)?.vacancySort).toEqual({ by: 'money', dir: 'desc' });
  });
});
