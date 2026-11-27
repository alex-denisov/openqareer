import { afterEach, describe, expect, it } from 'vitest';
import { createB640Harness, poolItem, type PoolRow } from '../testHelpers/b640VacancyHarness';

const NEW = '/api/v1/candidate/b640/matched-vacancies';
const OLD = '/api/v1/candidate/matched-vacancies';
const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});

const ROWS: PoolRow[] = [
  { id: 'cluster-1', title: 'Яблоко', company: 'Бета', location: 'Москва', observedAt: '2026-10-03T00:00:00.000Z', salaryFrom: 300_000, summary: 'гибрид' },
  { id: 'cluster-2', title: 'арбуз', company: 'Альфа', location: 'Санкт-Петербург', observedAt: '2026-10-01T00:00:00.000Z', salaryFrom: 100_000, summary: 'офис' },
  { id: 'cluster-3', title: 'Банан', company: 'Гамма', isRemote: true, firstObservedAt: '2026-10-02T00:00:00.000Z', salaryFrom: 200_000 },
  { id: 'cluster-4', title: 'Яблоко', company: 'Дельта', location: 'Казань', observedAt: '2026-10-03T00:00:00.000Z' },
  { id: 'cluster-5', title: 'Вишня', company: 'Эпсилон' },
];

async function setup(rows: PoolRow[] = ROWS) {
  const harness = await createB640Harness({ pool: () => rows.map(poolItem) });
  closers.push(harness.close);
  return harness;
}

const WORKSPACE = {
  resumeText: '', resumeSource: 'text' as const, targetDirection: '', regions: [],
  currentSituation: '', constraints: '', urgency: 'exploring' as const,
  vacancySort: { by: 'fit' as const, dir: 'desc' as const },
};

const ids = (response: { json: () => { data: Array<{ cluster: { id: string } }> } }) =>
  response.json().data.map((row) => row.cluster.id);

describe('GET b640/matched-vacancies: access', () => {
  it('answers 404 without a session or the flag, like a missing address', async () => {
    const { get } = await setup();
    const missing = await get('/api/v1/candidate/no-such-route', 'plain.test');
    for (const user of [undefined, 'plain.test'] as const) {
      const response = await get(NEW, user);
      expect(response.statusCode).toBe(404);
      expect(response.json().error.code).toBe(missing.json().error.code);
    }
    expect((await get(NEW, 'flagged.test')).statusCode).toBe(200);
  });

  it('rejects an unknown sort key and a limit above 50', async () => {
    const { get } = await setup();
    expect((await get(`${NEW}?sort=salary`, 'flagged.test')).statusCode).toBe(400);
    expect((await get(`${NEW}?limit=51`, 'flagged.test')).statusCode).toBe(400);
  });
});

describe('GET b640/matched-vacancies: column sort', () => {
  it.each([
    ['role', 'asc', ['cluster-2', 'cluster-3', 'cluster-5', 'cluster-1', 'cluster-4']],
    ['role', 'desc', ['cluster-1', 'cluster-4', 'cluster-5', 'cluster-3', 'cluster-2']],
    ['company', 'asc', ['cluster-2', 'cluster-1', 'cluster-3', 'cluster-4', 'cluster-5']],
    ['company', 'desc', ['cluster-5', 'cluster-4', 'cluster-3', 'cluster-1', 'cluster-2']],
  ])('%s %s', async (sort, direction, expected) => {
    const { get } = await setup();
    expect(ids(await get(`${NEW}?sort=${sort}&direction=${direction}`, 'flagged.test'))).toEqual(expected);
  });

  it('sorts by date both ways with empty last and ties in the earlier order', async () => {
    const { get } = await setup();
    const asc = ids(await get(`${NEW}?sort=date&direction=asc`, 'flagged.test'));
    const desc = ids(await get(`${NEW}?sort=date&direction=desc`, 'flagged.test'));
    // cluster-5 берёт firstObservedAt по умолчанию (2026-09-01): самая ранняя.
    expect(asc).toEqual(['cluster-5', 'cluster-2', 'cluster-3', 'cluster-1', 'cluster-4']);
    expect(desc).toEqual(['cluster-1', 'cluster-4', 'cluster-3', 'cluster-2', 'cluster-5']);
  });

  it('sorts by location with rows that have none last in both directions', async () => {
    const { get } = await setup();
    const asc = ids(await get(`${NEW}?sort=location&direction=asc`, 'flagged.test'));
    const desc = ids(await get(`${NEW}?sort=location&direction=desc`, 'flagged.test'));
    expect(asc.slice(-1)).toEqual(['cluster-5']);
    expect(desc.slice(-1)).toEqual(['cluster-5']);
    expect(asc.slice(0, 4)).toEqual([...desc.slice(0, 4)].reverse());
  });

  it('sorts by format with unknown last in both directions', async () => {
    const { get } = await setup();
    const asc = ids(await get(`${NEW}?sort=format&direction=asc`, 'flagged.test'));
    const desc = ids(await get(`${NEW}?sort=format&direction=desc`, 'flagged.test'));
    // гибрид < офис < удалённо
    expect(asc.slice(0, 3)).toEqual(['cluster-1', 'cluster-2', 'cluster-3']);
    expect(desc.slice(0, 3)).toEqual(['cluster-3', 'cluster-2', 'cluster-1']);
    expect(new Set(asc.slice(3))).toEqual(new Set(['cluster-4', 'cluster-5']));
    expect(new Set(desc.slice(3))).toEqual(new Set(['cluster-4', 'cluster-5']));
  });

  it('keeps the fit and money keys, money empty last', async () => {
    const { get } = await setup();
    const desc = ids(await get(`${NEW}?sort=money&direction=desc`, 'flagged.test'));
    expect(desc.slice(0, 3)).toEqual(['cluster-1', 'cluster-3', 'cluster-2']);
    const asc = ids(await get(`${NEW}?sort=money&direction=asc`, 'flagged.test'));
    expect(asc.slice(0, 3)).toEqual(['cluster-2', 'cluster-3', 'cluster-1']);
    expect((await get(`${NEW}?sort=fit`, 'flagged.test')).statusCode).toBe(200);
  });

  it('pages agree with the whole order, with a total', async () => {
    const { get } = await setup();
    const all = ids(await get(`${NEW}?sort=company&direction=asc&limit=50`, 'flagged.test'));
    const first = await get(`${NEW}?sort=company&direction=asc&limit=2`, 'flagged.test');
    const second = await get(`${NEW}?sort=company&direction=asc&limit=2&offset=2`, 'flagged.test');
    const third = await get(`${NEW}?sort=company&direction=asc&limit=2&offset=4`, 'flagged.test');
    expect([...ids(first), ...ids(second), ...ids(third)]).toEqual(all);
    expect(first.json().meta).toMatchObject({ total: 5, nextOffset: 2, limit: 2 });
    expect(third.json().meta).toMatchObject({ total: 5, nextOffset: null });
  });

  it('never returns another candidate\'s skipped vacancy', async () => {
    const { get, candidates, candidateIds } = await setup();
    candidates.createVacancySkip(candidateIds['other.test'], { clusterId: 'cluster-1', reasonId: 'company', origin: 'vacancy_card' });
    candidates.createVacancySkip(candidateIds['flagged.test'], { clusterId: 'cluster-2', reasonId: 'company', origin: 'vacancy_card' });
    const mine = ids(await get(`${NEW}?limit=50`, 'flagged.test'));
    expect(mine).toContain('cluster-1');
    expect(mine).not.toContain('cluster-2');
  });
});

describe('B640 sort does not touch the old route', () => {
  it('leaves the old answer and the remembered sort unchanged', async () => {
    const { get, candidates, candidateIds } = await setup();
    const id = candidateIds['flagged.test'];
    candidates.saveCandidateWorkspace(id, WORKSPACE);
    const before = (await get(OLD, 'flagged.test')).body;
    const sortBefore = candidates.getCandidateWorkspace(id)?.vacancySort;
    for (const query of ['sort=company&direction=asc', 'sort=money&direction=asc', 'sort=date']) {
      await get(`${NEW}?${query}`, 'flagged.test');
    }
    const after = (await get(OLD, 'flagged.test')).body;
    expect(JSON.parse(after).data.map((r: { cluster: { id: string } }) => r.cluster.id))
      .toEqual(JSON.parse(before).data.map((r: { cluster: { id: string } }) => r.cluster.id));
    expect(sortBefore).toEqual({ by: 'fit', dir: 'desc' });
    expect(candidates.getCandidateWorkspace(id)?.vacancySort).toEqual(sortBefore);
  });

  it('old route still saves its own sort and ignores unknown new keys', async () => {
    const { get, candidates, candidateIds } = await setup();
    candidates.saveCandidateWorkspace(candidateIds['plain.test'], WORKSPACE);
    expect((await get(`${OLD}?sort=money&dir=asc`, 'plain.test')).statusCode).toBe(200);
    expect(candidates.getCandidateWorkspace(candidateIds['plain.test'])?.vacancySort).toEqual({ by: 'money', dir: 'asc' });
    expect((await get(`${OLD}?sort=company`, 'plain.test')).statusCode).toBe(400);
  });
});

describe('GET b640/matched-vacancies: «Дата» на сервере (B726)', () => {
  const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
  const RECENT: PoolRow[] = [
    { id: 'fresh-1', title: 'CTO', company: 'Альфа', observedAt: daysAgo(2) },
    { id: 'fresh-2', title: 'CTO', company: 'Бета', observedAt: daysAgo(20) },
    { id: 'old-1', title: 'CTO', company: 'Гамма', observedAt: daysAgo(45) },
  ];

  it('days=30 — только строки за 30 дней, число подборки по ним', async () => {
    const { get } = await setup(RECENT);
    const response = await get(`${NEW}?sort=date&direction=desc&days=30&tz=Europe%2FMoscow`, 'flagged.test');
    expect(response.statusCode).toBe(200);
    expect(ids(response)).toEqual(['fresh-1', 'fresh-2']);
    expect(response.json().meta.total).toBe(2);
    expect(response.json().meta.nextOffset).toBeNull();
  });

  it('без days — все строки; неверные days — 400', async () => {
    const { get } = await setup(RECENT);
    expect(ids(await get(`${NEW}?sort=date&direction=desc`, 'flagged.test'))).toHaveLength(3);
    expect((await get(`${NEW}?days=-1`, 'flagged.test')).statusCode).toBe(400);
    expect((await get(`${NEW}?days=abc`, 'flagged.test')).statusCode).toBe(400);
  });
});

describe('GET b640/matched-vacancies: «Зарплата от» на сервере (B765, B645 s07)', () => {
  it('money — суммы в месяц не ниже порога и строки без суммы, число подборки по ним', async () => {
    const { get } = await setup();
    const response = await get(`${NEW}?sort=date&direction=desc&money=200000&moneyCurrency=RUB`, 'flagged.test');
    expect(response.statusCode).toBe(200);
    expect([...ids(response)].sort()).toEqual(['cluster-1', 'cluster-3', 'cluster-4', 'cluster-5']);
    expect(response.json().meta.total).toBe(4);
  });

  it('без money — все строки; неверные money и валюта — 400', async () => {
    const { get } = await setup();
    expect(ids(await get(`${NEW}?sort=date&direction=desc`, 'flagged.test'))).toHaveLength(5);
    expect((await get(`${NEW}?money=-1&moneyCurrency=RUB`, 'flagged.test')).statusCode).toBe(400);
    expect((await get(`${NEW}?money=100000&moneyCurrency=XYZ`, 'flagged.test')).statusCode).toBe(400);
  });
});

describe('GET b640/matched-vacancies: первое чтение с ролями поиска', () => {
  it('roles=campaign отвечает тем же, что явные роли, и называет их; с role — не подставляет', async () => {
    const { get } = await setup([...ROWS, { id: 'cluster-6', title: 'Инженер данных', company: 'Зета', location: 'Москва' }]);
    const auto = (await get(`${NEW}?roles=campaign&tz=Europe/Moscow`, 'flagged.test')).json();
    const { value, origin } = auto.meta.campaign.roles as { value: string[]; origin: string };
    expect(auto.meta.roles).toEqual(origin === 'default' ? [] : value);
    const query = (auto.meta.roles as string[]).map((role) => `&role=${encodeURIComponent(role)}`).join('');
    const explicit = (await get(`${NEW}?tz=Europe/Moscow${query}`, 'flagged.test')).json();
    expect(auto.data).toEqual(explicit.data);
    expect(auto.meta.total).toBe(1);
    expect(auto.meta.total).toBe(explicit.meta.total);
    expect(auto.meta.facets).toEqual(explicit.meta.facets);
    expect(explicit.meta.roles).toBeUndefined();
    const own = (await get(`${NEW}?roles=campaign&role=${encodeURIComponent('Инженер данных')}`, 'flagged.test')).json();
    expect(own.data).toEqual(auto.data);
    expect(own.meta.roles).toBeUndefined();
    expect((await get(`${NEW}?roles=all`, 'flagged.test')).statusCode).toBe(400);
  });
});
