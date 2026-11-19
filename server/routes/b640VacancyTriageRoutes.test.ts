import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { createB640Harness, poolItem } from '../testHelpers/b640VacancyHarness';
import { forgetMatchedListsForTests } from './matchedVacancyList';
import { timeBudget } from '../../shared/testing/timeBudget';

const URL = '/api/v1/candidate/b640/vacancy-triage';
const OLD = '/api/v1/candidate/matched-vacancies';
const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  forgetMatchedListsForTests();
  for (const close of closers.splice(0)) await close();
});

async function setup() {
  const pool = [
    poolItem({ id: 'cluster-a', title: 'Роль a', company: 'К', salaryFrom: 100_000 }),
    poolItem({ id: 'cluster-b', title: 'Роль b', company: 'К', salaryFrom: 400_000 }),
    poolItem({ id: 'cluster-c', title: 'Роль c', company: 'К' }),
    poolItem({ id: 'cluster-d', title: 'Роль d', company: 'К' }),
  ];
  const harness = await createB640Harness({ pool: () => pool });
  closers.push(harness.close);
  return harness;
}
const ids = (body: { data: { rows: Array<{ clusterId: string }> } }) => body.data.rows.map((row) => row.clusterId);

describe('POST b640/vacancy-triage', () => {
  it('answers 404 without a session and without the flag, like a missing address', async () => {
    const { post, get } = await setup();
    const missing = await get('/api/v1/candidate/no-such-route', 'plain.test');
    for (const user of [undefined, 'plain.test'] as const) {
      const response = await post(URL, { clusterIds: ['cluster-a'] }, user);
      expect(response.statusCode).toBe(404);
      expect(response.json().error.code).toBe(missing.json().error.code);
    }
  });

  it('answers 200 with the contract shape, rows in request order', async () => {
    const { post } = await setup();
    const response = await post(URL, { clusterIds: ['cluster-c', 'cluster-a', 'cluster-d'] }, 'flagged.test');
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(ids(body)).toEqual(['cluster-c', 'cluster-a', 'cluster-d']);
    expect(body.data.summary).toEqual({ total: 3, keep: 3, hide: 0, needsData: 0 });
    expect(body.data.questions).toEqual([]);
    expect(body.data.questionTotal).toBe(0);
    expect(typeof body.meta.requestId).toBe('string');
  });

  it('leaves out unknown, another candidate\'s hidden and vanished ids', async () => {
    const { post, candidates, candidateIds } = await setup();
    candidates.createVacancySkip(candidateIds['flagged.test'], { clusterId: 'cluster-b', reasonId: 'company', origin: 'vacancy_card' });
    candidates.createVacancySkip(candidateIds['other.test'], { clusterId: 'cluster-c', reasonId: 'company', origin: 'vacancy_card' });
    const body = (await post(URL, { clusterIds: ['cluster-a', 'cluster-b', 'cluster-c', 'no-such'] }, 'flagged.test')).json();
    expect(ids(body)).toEqual(['cluster-a', 'cluster-c']);
    expect(body.data.summary.total).toBe(2);
  });

  it('applies the salary floor from the stored conditions and the question flow', async () => {
    const { post, candidates, candidateIds } = await setup();
    candidates.decisionProfileRepo.put(
      candidateIds['flagged.test'],
      { citizenship: [], languages: [], workFormats: [], salaryFloor: 200_000, salaryCurrency: 'RUB' },
      '2026-11-17T00:00:00.000Z',
    );
    const body = (await post(URL, { clusterIds: ['cluster-a', 'cluster-b', 'cluster-c'] }, 'flagged.test')).json();
    expect(body.data.rows[0]).toMatchObject({ clusterId: 'cluster-a', verdict: 'hide', reasonId: 'comp-below' });
    expect(body.data.rows[1].verdict).toBe('keep');
    expect(body.data.summary).toEqual({ total: 3, keep: 2, hide: 1, needsData: 0 });
  });

  it('rejects 1001 ids, a repeated id, empty list, unknown answer keys and non-boolean answers', async () => {
    const { post } = await setup();
    const many = Array.from({ length: 1001 }, (_, i) => `id-${i}`);
    const bad: unknown[] = [
      { clusterIds: many },
      { clusterIds: ['cluster-a', 'cluster-a'] },
      { clusterIds: [] },
      { clusterIds: [''] },
      { clusterIds: ['cluster-a'], answers: { other: true } },
      { clusterIds: ['cluster-a'], answers: { salaryLowerBound: 'yes' } },
      { clusterIds: ['cluster-a'], extra: 1 },
    ];
    for (const payload of bad) {
      const response = await post(URL, payload, 'flagged.test');
      expect(response.statusCode).toBe(400);
      expect(JSON.stringify(response.json())).not.toMatch(/zod|stack/i);
    }
    expect((await post(URL, { clusterIds: many.slice(0, 1000) }, 'flagged.test')).statusCode).toBe(200);
  });

  it('writes nothing: sealed row, skips and old route answer stay the same', async () => {
    const h = await setup();
    const id = h.candidateIds['flagged.test'];
    const first = await h.get(OLD, 'flagged.test');
    const sealed = () => {
      const database = new DatabaseSync(h.databasePath, { readOnly: true });
      try {
        return database.prepare('SELECT candidate_id, built_at, cipher FROM sealed_matched_lists WHERE candidate_id = ?').get(id);
      } finally {
        database.close();
      }
    };
    const before = sealed();
    const skips = JSON.stringify(h.candidates.listVacancySkips(id));
    await h.post(URL, { clusterIds: ['cluster-a', 'cluster-b'], answers: { salaryLowerBound: true } }, 'flagged.test');
    expect(sealed()).toEqual(before);
    expect(JSON.stringify(h.candidates.listVacancySkips(id))).toBe(skips);
    expect((await h.get(OLD, 'flagged.test')).json().data).toEqual(first.json().data);
  });

  describe('tracker cards', () => {
    const SNAPSHOT = { title: 'Роль', company: 'К', url: 'https://example.test/x', source: 'src' };
    const floor = { citizenship: [], languages: [], workFormats: [], salaryFloor: 200_000, salaryCurrency: 'RUB' };
    async function withFloor() {
      const h = await setup();
      h.candidates.decisionProfileRepo.put(h.candidateIds['flagged.test'], floor, '2026-11-17T00:00:00.000Z');
      const card = (user: 'flagged.test' | 'other.test', stage: 'saved' | 'applied' | 'archived') =>
        h.candidates.createApplication(h.candidateIds[user], { clusterId: 'cluster-a', vacancy: SNAPSHOT, stage });
      const verdict = async () => (await h.post(URL, { clusterIds: ['cluster-a'] }, 'flagged.test')).json().data.rows[0].verdict;
      return { h, card, verdict };
    }

    it('keeps a vacancy with a saved or applied card', async () => {
      for (const stage of ['saved', 'applied'] as const) {
        const { card, verdict } = await withFloor();
        expect(await verdict()).toBe('hide');
        card('flagged.test', stage);
        expect(await verdict()).toBe('keep');
      }
    });

    it('applies the usual rules to an archived card and ignores another candidate\'s card', async () => {
      const { card, verdict } = await withFloor();
      card('other.test', 'applied');
      expect(await verdict()).toBe('hide');
      const archived = card('flagged.test', 'archived');
      expect(archived.stage).toBe('archived');
      expect(await verdict()).toBe('hide');
    });

    it('leaves the tracker table unchanged', async () => {
      const { h, card } = await withFloor();
      card('flagged.test', 'saved');
      const dump = () => {
        const database = new DatabaseSync(h.databasePath, { readOnly: true });
        try {
          return JSON.stringify(database.prepare('SELECT * FROM applications ORDER BY id').all());
        } finally {
          database.close();
        }
      };
      const before = dump();
      await h.post(URL, { clusterIds: ['cluster-a', 'cluster-b'] }, 'flagged.test');
      expect(dump()).toBe(before);
    });
  });
  describe('whole pool by filters, without ids', () => {
    async function poolSetup(size = 4) {
      const pool = Array.from({ length: size }, (_, index) =>
        poolItem({
          id: `pool-${index}`,
          title: `Роль ${index}`,
          company: 'К',
          isRemote: index % 2 === 0,
          location: index % 2 === 0 ? 'Удалённо' : 'Москва',
        }),
      );
      const harness = await createB640Harness({ pool: () => pool });
      closers.push(harness.close);
      return harness;
    }

    it('answers 404 without a session and without the flag', async () => {
      const { post } = await poolSetup();
      for (const user of [undefined, 'plain.test'] as const) {
        expect((await post(URL, { query: '' }, user)).statusCode).toBe(404);
      }
    });

    it('triages every vacancy of the candidate pool when no ids are sent', async () => {
      const { post, get } = await poolSetup();
      const list = (await get('/api/v1/candidate/b640/matched-vacancies?limit=50', 'flagged.test')).json();
      const body = (await post(URL, { query: '' }, 'flagged.test')).json();
      expect(ids(body)).toEqual(list.data.map((item: { cluster: { id: string } }) => item.cluster.id));
      expect(body.data.summary.total).toBe(4);
      expect(body.data.poolTotal).toBe(4);
    });

    it('applies the same filters as the list route', async () => {
      const { post, get } = await poolSetup();
      const list = (await get('/api/v1/candidate/b640/matched-vacancies?remote=1&limit=50', 'flagged.test')).json();
      const body = (await post(URL, { query: 'remote=1' }, 'flagged.test')).json();
      expect(list.data.length).toBeGreaterThan(0);
      expect(list.data.length).toBeLessThan(4);
      expect(ids(body)).toEqual(list.data.map((item: { cluster: { id: string } }) => item.cluster.id));
      expect(body.data.poolTotal).toBe(list.data.length);
    });

    it('leaves out vacancies the candidate has hidden', async () => {
      const { post, candidates, candidateIds } = await poolSetup();
      candidates.createVacancySkip(candidateIds['flagged.test'], { clusterId: 'pool-1', reasonId: 'company', origin: 'vacancy_card' });
      const body = (await post(URL, { query: '' }, 'flagged.test')).json();
      expect(ids(body)).not.toContain('pool-1');
      expect(body.data.summary.total).toBe(3);
    });

    it('triages the first 1000 in list order and reports the pool size beyond the cap', async () => {
      const { post } = await poolSetup(1_005);
      const started = performance.now();
      const body = (await post(URL, { query: '' }, 'flagged.test')).json();
      const elapsed = performance.now() - started;
      expect(body.data.rows).toHaveLength(1_000);
      expect(body.data.summary.total).toBe(1_000);
      expect(body.data.poolTotal).toBe(1_005);
      expect(elapsed).toBeLessThan(timeBudget(5_000));
    });

    it('rejects a body with both ids and a query, an unknown filter value and an oversized query', async () => {
      const { post } = await poolSetup();
      for (const payload of [
        { clusterIds: ['pool-0'], query: '' },
        { query: 'sort=nonsense' },
        { query: 'x'.repeat(2_001) },
        {},
      ]) {
        expect((await post(URL, payload, 'flagged.test')).statusCode).toBe(400);
      }
    });

    it('keeps the old route answer and the sealed row untouched', async () => {
      const { post, get } = await poolSetup();
      const before = (await get(OLD, 'flagged.test')).json();
      await post(URL, { query: '' }, 'flagged.test');
      await post(URL, { query: 'remote=1' }, 'flagged.test');
      const after = (await get(OLD, 'flagged.test')).json();
      expect(after.data.map((item: { cluster: { id: string } }) => item.cluster.id)).toEqual(
        before.data.map((item: { cluster: { id: string } }) => item.cluster.id),
      );
    });
  });
});
