import { afterEach, describe, expect, it } from 'vitest';
import { createB640Harness, poolItem } from '../testHelpers/b640VacancyHarness';

const URL = '/api/v1/candidate/b640/hidden-vacancies';
const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});

async function setup(ids = ['a', 'b', 'c', 'd']) {
  let pool = ids.map((id) => poolItem({ id: `cluster-${id}`, title: `Роль ${id}`, company: 'К' }));
  const harness = await createB640Harness({ pool: () => pool });
  closers.push(harness.close);
  return { ...harness, dropFromPool: (id: string) => { pool = pool.filter((item) => item.cluster.id !== id); } };
}

describe('GET b640/hidden-vacancies', () => {
  it('answers 404 without a session, without the flag, like a missing address', async () => {
    const { get } = await setup();
    const missing = await get('/api/v1/candidate/no-such-route', 'plain.test');
    for (const user of [undefined, 'plain.test'] as const) {
      const response = await get(URL, user);
      expect(response.statusCode).toBe(404);
      expect(response.json().error.code).toBe(missing.json().error.code);
    }
  });

  it('returns hidden rows with reason and time, only this candidate\'s', async () => {
    const { get, candidates, candidateIds } = await setup();
    candidates.createVacancySkip(candidateIds['flagged.test'], { clusterId: 'cluster-a', reasonId: 'company', origin: 'vacancy_card' });
    candidates.createVacancySkip(candidateIds['other.test'], { clusterId: 'cluster-b', reasonId: 'level', origin: 'kanban' });
    const response = await get(URL, 'flagged.test');
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].cluster.id).toBe('cluster-a');
    expect(body.data[0].explanation.clusterId).toBe('cluster-a');
    expect(body.data[0].hidden.reasonId).toBe('company');
    expect(new Date(body.data[0].hidden.at).toISOString()).toBe(body.data[0].hidden.at);
    expect(body.meta).toMatchObject({ total: 1, offset: 0, limit: 20, nextOffset: null });
    const other = (await get(URL, 'other.test')).json();
    expect(other.data.map((row: { cluster: { id: string } }) => row.cluster.id)).toEqual(['cluster-b']);
  });

  it('does not return or count a vacancy that left the pool', async () => {
    const { get, candidates, candidateIds, dropFromPool } = await setup();
    for (const id of ['a', 'b']) {
      candidates.createVacancySkip(candidateIds['flagged.test'], { clusterId: `cluster-${id}`, reasonId: 'stale', origin: 'vacancy_card' });
    }
    dropFromPool('cluster-a');
    const body = (await get(URL, 'flagged.test')).json();
    expect(body.data.map((row: { cluster: { id: string } }) => row.cluster.id)).toEqual(['cluster-b']);
    expect(body.meta.total).toBe(1);
  });

  it('pages with offset and limit and rejects a limit above 50', async () => {
    const { get, candidates, candidateIds } = await setup();
    for (const id of ['a', 'b', 'c']) {
      candidates.createVacancySkip(candidateIds['flagged.test'], { clusterId: `cluster-${id}`, reasonId: 'company', origin: 'vacancy_card' });
    }
    const first = (await get(`${URL}?limit=2`, 'flagged.test')).json();
    const second = (await get(`${URL}?limit=2&offset=2`, 'flagged.test')).json();
    const ids = [...first.data, ...second.data].map((row: { cluster: { id: string } }) => row.cluster.id);
    expect(new Set(ids).size).toBe(3);
    expect(first.meta).toMatchObject({ total: 3, nextOffset: 2 });
    expect(second.meta).toMatchObject({ total: 3, nextOffset: null });
    expect((await get(`${URL}?limit=51`, 'flagged.test')).statusCode).toBe(400);
    expect((await get(`${URL}?offset=-1`, 'flagged.test')).statusCode).toBe(400);
  });

  it('writes nothing: skips are unchanged after reading', async () => {
    const { get, candidates, candidateIds } = await setup();
    const id = candidateIds['flagged.test'];
    candidates.createVacancySkip(id, { clusterId: 'cluster-a', reasonId: 'company', origin: 'vacancy_card' });
    const before = JSON.stringify(candidates.listVacancySkips(id));
    await get(URL, 'flagged.test');
    expect(JSON.stringify(candidates.listVacancySkips(id))).toBe(before);
  });
});
