import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { createB640Harness, poolItem, type PoolRow } from '../testHelpers/b640VacancyHarness';
import { timeBudget } from '../../shared/testing/timeBudget';
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
  {
    id: 'cluster-1',
    title: 'Яблоко',
    company: 'Бета',
    location: 'Москва',
    observedAt: '2026-10-03T00:00:00.000Z',
    salaryFrom: 300_000,
  },
  {
    id: 'cluster-2',
    title: 'арбуз',
    company: 'Альфа',
    location: 'Санкт-Петербург',
    observedAt: '2026-10-01T00:00:00.000Z',
    salaryFrom: 100_000,
  },
  { id: 'cluster-3', title: 'Банан', company: 'Гамма', isRemote: true, salaryFrom: 200_000 },
  { id: 'cluster-4', title: 'Яблоко', company: 'Дельта', location: 'Казань' },
];
const POOL = ROWS.map(poolItem);

const workspace = (by: 'fit' | 'money', dir: 'desc' | 'asc') => ({
  resumeText: '',
  resumeSource: 'text' as const,
  targetDirection: '',
  regions: [],
  currentSituation: '',
  constraints: '',
  urgency: 'exploring' as const,
  vacancySort: { by, dir },
});

async function setup(
  saved: { by: 'fit' | 'money'; dir: 'desc' | 'asc' } = { by: 'fit', dir: 'desc' },
  pool = POOL,
) {
  const lines: string[] = [];
  const harness = await createB640Harness({ pool: () => pool, logLines: lines });
  closers.push(harness.close);
  const id = harness.candidateIds['flagged.test'];
  harness.candidates.saveCandidateWorkspace(id, workspace(saved.by, saved.dir));
  const sealedRow = () => {
    const database = new DatabaseSync(harness.databasePath, { readOnly: true });
    try {
      return database
        .prepare(
          `SELECT candidate_id, choice, built_at, cipher FROM sealed_matched_list_choices
           WHERE candidate_id = ? ORDER BY choice`,
        )
        .all(id);
    } finally {
      database.close();
    }
  };
  const ids = (body: string): string[] =>
    JSON.parse(body).data.map((r: { cluster: { id: string } }) => r.cluster.id);
  const user = 'flagged.test' as const;
  const lastServed = (): unknown =>
    lines
      .map((line) => JSON.parse(line))
      .filter((line) => line.msg === 'matched-vacancies-timing')
      .at(-1)?.listServed;
  const servedSealed = (): number =>
    lines.filter((line) => JSON.parse(line).msg === 'b640-matched-served-sealed').length;
  return { ...harness, lastServed, servedSealed, id, sealedRow, ids, user };
}

const within = <T>(work: Promise<T>, ms: number, what: string): Promise<T> =>
  Promise.race([
    work,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${what}: no answer in ${ms} ms (cold read)`)), ms),
    ),
  ]);

const FILTERS = [
  'role=Инженер данных',
  'region=eu',
  'level=ic',
  'source=src',
  'remote=1',
  'place=Москва',
];

// B776: the main view (roles only) is sealed by the new route too; the other filters never are.
const NARROWING = FILTERS.filter((filter) => !filter.startsWith('role='));

describe('B674: filters never reseal the list', () => {
  it('keeps the sealed row byte for byte for each filter and their mix', async () => {
    const h = await setup();
    await h.get(OLD, h.user);
    const before = h.sealedRow();
    const queries = [...NARROWING, NARROWING.join('&'), FILTERS.join('&')];
    for (const query of queries) {
      expect((await h.get(`${NEW}?${query}&sort=company`, h.user)).statusCode).toBe(200);
    }
    expect(h.sealedRow()).toEqual(before);
  });

  it('the old route without filters answers sealed, same ids, after filtered calls', async () => {
    const h = await setup();
    const first = h.ids((await h.get(OLD, h.user)).body);
    for (const query of FILTERS) await h.get(`${NEW}?${query}`, h.user);
    forgetMatchedListsForTests();
    h.hangPool(true);
    const again = await within(h.get(OLD, h.user), timeBudget(3000), 'old route');
    expect(h.ids(again.body)).toEqual(first);
    expect(h.lastServed()).toBe('sealed');
  });

  it('the old route with filters still seals its own list', async () => {
    const h = await setup();
    await h.get(OLD, h.user);
    const before = h.sealedRow();
    await h.get(`${OLD}?remote=1`, h.user);
    expect(h.sealedRow()).not.toEqual(before);
  });
});

describe('B674: the new route leaves what the old route reads', () => {
  it('keeps the sealed row byte for byte and the remembered sort, for every sort both ways', async () => {
    const h = await setup();
    expect((await h.get(OLD, h.user)).statusCode).toBe(200);
    const before = h.sealedRow();
    expect(before).toHaveLength(1);
    for (const sort of SORTS) {
      for (const direction of ['asc', 'desc']) {
        expect((await h.get(`${NEW}?sort=${sort}&direction=${direction}`, h.user)).statusCode).toBe(
          200,
        );
      }
    }
    expect(h.sealedRow()).toEqual(before);
    expect(h.candidates.getCandidateWorkspace(h.id)?.vacancySort).toEqual({
      by: 'fit',
      dir: 'desc',
    });
  });

  it('lets the old route answer from the sealed list, same ids, after the new one', async () => {
    const h = await setup();
    const first = h.ids((await h.get(OLD, h.user)).body);
    for (const sort of SORTS) await h.get(`${NEW}?sort=${sort}&direction=asc`, h.user);
    forgetMatchedListsForTests();
    h.hangPool(true);
    const again = await within(h.get(OLD, h.user), timeBudget(3000), 'old route');
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
    const expected = fitAccount.ids(
      (await fitAccount.get(`${NEW}?sort=fit`, fitAccount.user)).body,
    );
    const money = await setup({ by: 'money', dir: 'desc' });
    const byFit = money.ids((await money.get(`${NEW}?sort=fit`, money.user)).body);
    expect(byFit).toEqual(expected);
    expect(money.candidates.getCandidateWorkspace(money.id)?.vacancySort).toEqual({
      by: 'money',
      dir: 'desc',
    });
  });
});

describe('B702: a new process answers the first read of the new route from the sealed list', () => {
  it('answers sort=fit within 3 s while the pool hangs, same rows and total as the built list', async () => {
    const h = await setup();
    const built = await h.get(`${NEW}?sort=fit`, h.user);
    await h.get(OLD, h.user);
    forgetMatchedListsForTests();
    h.hangPool(true);
    const cold = await within(h.get(`${NEW}?sort=fit`, h.user), timeBudget(3000), 'new route');
    expect(cold.statusCode).toBe(200);
    expect(h.ids(cold.body)).toEqual(h.ids(built.body));
    expect(JSON.parse(cold.body).meta.total).toBe(JSON.parse(built.body).meta.total);
    expect(JSON.parse(cold.body).meta.facets).toEqual(JSON.parse(built.body).meta.facets);
  });

  it('a page past the sealed rows or another sort is built as before', async () => {
    const h = await setup();
    await h.get(OLD, h.user);
    forgetMatchedListsForTests();
    const company = await h.get(`${NEW}?sort=company&direction=asc`, h.user);
    expect(company.statusCode).toBe(200);
    expect(h.ids(company.body)).toEqual(['cluster-2', 'cluster-1', 'cluster-3', 'cluster-4']);
  });
});

type SealedChoiceRow = { readonly choice: string };

describe('B776: the new route seals its main view (roles only), a new process answers it sealed', () => {
  // Роль фильтра должна быть среди целевых ролей кандидата; у харнеса она одна.
  const ROLES = `role=${encodeURIComponent('Инженер данных')}&sort=fit`;
  const DATA_POOL = [
    ...POOL,
    poolItem({ id: 'cluster-5', title: 'Инженер данных', company: 'Эпсилон', location: 'Москва' }),
    poolItem({ id: 'cluster-6', title: 'Инженер данных', company: 'Зета', isRemote: true }),
  ];
  const fit = { by: 'fit', dir: 'desc' } as const;

  it('a cold read of the same roles answers sealed within 3 s while the pool hangs', async () => {
    const h = await setup(fit, DATA_POOL);
    const built = await h.get(`${NEW}?${ROLES}`, h.user);
    expect(built.statusCode, built.body).toBe(200);
    expect(h.sealedRow()).toHaveLength(1);
    forgetMatchedListsForTests();
    h.hangPool(true);
    const cold = await within(h.get(`${NEW}?${ROLES}`, h.user), timeBudget(3000), 'new route');
    expect(h.ids(cold.body)).toEqual(h.ids(built.body));
    expect(h.servedSealed()).toBe(1);
  });

  it('the general row stays byte for byte; a narrowing filter adds no row', async () => {
    const h = await setup(fit, DATA_POOL);
    await h.get(OLD, h.user);
    const general = h.sealedRow();
    await h.get(`${NEW}?${ROLES}`, h.user);
    const afterRoles = h.sealedRow() as SealedChoiceRow[];
    expect(afterRoles).toHaveLength(2);
    expect(afterRoles).toEqual(expect.arrayContaining(general as SealedChoiceRow[]));
    await h.get(`${NEW}?${ROLES}&remote=1`, h.user);
    expect(h.sealedRow()).toEqual(afterRoles);
  });

  it('does not serve another choice or another candidate', async () => {
    const h = await setup(fit, DATA_POOL);
    await h.get(`${NEW}?${ROLES}`, h.user);
    forgetMatchedListsForTests();
    expect((await h.get(`${NEW}?sort=fit`, h.user)).statusCode).toBe(200);
    const other = await h.get(`${NEW}?${ROLES}`, 'other.test');
    expect(other.statusCode, other.body).toBe(200);
    expect(h.servedSealed()).toBe(0);
  });
});
