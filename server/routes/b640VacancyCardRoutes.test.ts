import { afterEach, describe, expect, it } from 'vitest';
import { SqliteHhSessionRepository } from '../candidate/sqliteHhSessionRepository';
import { createB640Harness, poolItem } from '../testHelpers/b640VacancyHarness';
import { forgetMatchedListsForTests } from './matchedVacancyList';

const BASE = '/api/v1/candidate/b640/vacancies';
const LIVE = {
  id: 'src-hh-search:139180469', fingerprint: 'f', title: 'Директор по данным', company: 'Ромашка',
  description: 'Платформа данных', requiredSkills: [], isRemote: true, url: 'https://hh.ru/vacancy/139180469',
  publishedAt: '2026-11-17T00:00:00.000Z', status: 'active',
  provenance: { sourceType: 'json_api', sourceId: 'src-hh-search', sourceUrl: 'https://hh.ru/vacancy/139180469', observedAt: '2026-11-18T00:00:00.000Z' },
};
const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  forgetMatchedListsForTests();
  for (const close of closers.splice(0)) await close();
});

async function setup() {
  // Движок прода: сохранённого кластера нет, подборка собирает его из живой записи пула на запросе.
  const harness = await createB640Harness({
    pool: () => [poolItem({ id: 'cluster-a', title: 'Роль a', company: 'К' })],
    engine: {
      getVacancy: (id: string) => (id === LIVE.id ? LIVE : undefined),
      getActiveCluster: () => undefined,
      openedVacancyGone: async () => true,
      isKnownVacancyGone: (id: string) => id === 'cluster-src-hh-search:44444444',
    },
  });
  closers.push(harness.close);
  return harness;
}

describe('B715: GET b640/vacancies/:id — карточка вакансии вне подборки', () => {
  it('вакансия пула по id строки cluster-src-hh-search:<n> — кластер и объяснение', async () => {
    const h = await setup();
    const response = await h.get(`${BASE}/${encodeURIComponent('cluster-src-hh-search:139180469')}`, 'flagged.test');
    expect(response.statusCode).toBe(200);
    const { data } = response.json();
    expect(data.cluster).toMatchObject({ id: 'cluster-src-hh-search:139180469', canonicalTitle: 'Директор по данным', canonicalCompany: 'Ромашка', status: 'active' });
    expect(data.explanation.clusterId).toBe('cluster-src-hh-search:139180469');
  });
  it('неизвестная запись — 404, снятая — 410', async () => {
    const h = await setup();
    expect((await h.get(`${BASE}/cluster-src-hh-search:99999999`, 'flagged.test')).statusCode).toBe(404);
    expect((await h.get(`${BASE}/cluster-src-hh-search:44444444`, 'flagged.test')).statusCode).toBe(410);
  });
  it('B797: сверка отвечает отдельно от карточки; неизвестная запись — 404', async () => {
    const h = await setup();
    const path = `${BASE}/${encodeURIComponent('cluster-src-hh-search:139180469')}`;
    expect((await h.post(`${path}/liveness`, {}, 'flagged.test')).json().data).toEqual({ closed: true });
    expect((await h.get(path, 'flagged.test')).statusCode).toBe(200);
    const gone = `${BASE}/cluster-src-hh-search:44444444/liveness`;
    expect((await h.post(gone, {}, 'flagged.test')).json().data).toEqual({ closed: true });
    const unknown = `${BASE}/cluster-src-hh-search:99999999/liveness`;
    expect((await h.post(unknown, {}, 'flagged.test')).statusCode).toBe(404);
  });
  it('B787: цель отклика — в карточке и по POST; чужому и без флага — 404', async () => {
    const h = await setup();
    const path = `${BASE}/${encodeURIComponent('cluster-src-hh-search:139180469')}`;
    const target = {
      channel: 'hh',
      url: 'https://hh.ru/vacancy/139180469',
      formUrl: 'https://hh.ru/vacancy/139180469',
      origin: 'url',
    };
    expect((await h.get(path, 'flagged.test')).json().data.applyTarget).toEqual(target);
    const post = await h.post(`${path}/apply-target`, {}, 'flagged.test');
    expect(post.json().data.applyTarget).toEqual(target);
    const foreign = await h.app.inject({
      method: 'POST',
      url: `${path}/apply-target`,
      headers: { cookie: `openqareer_session=${h.tokens['flagged.test']}`, origin: 'https://evil.example' },
    });
    expect(foreign.statusCode).toBe(403);
    expect((await h.post(`${path}/apply-target`, {}, 'plain.test')).statusCode).toBe(404);
    expect(
      (await h.post(`${BASE}/cluster-src-hh-search:99999999/apply-target`, {}, 'flagged.test'))
        .statusCode,
    ).toBe(404);
  });
  it('B787: пока отклик уходит через hh.ru, цель карточки не меняется', async () => {
    const h = await setup();
    const card = 'cluster-src-hh-search:139180469';
    const path = `${BASE}/${encodeURIComponent(card)}`;
    const hh = new SqliteHhSessionRepository({ databasePath: h.databasePath, encryptionKey: Buffer.alloc(32, 8) });
    closers.push(async () => hh.close());
    const start = (cardId: string, vacancyId: string, now = new Date()) =>
      hh.startAttempt(h.candidateIds['flagged.test'], { vacancyId, resumeId: 'r', cardId, now });
    const first = async () => (await h.get(path, 'flagged.test')).json().data.cluster.sources[0].sourceUrl;
    start('cluster-other', '555');
    start(card, '666', new Date(Date.now() - 6 * 60_000));
    expect(await first()).toBe(LIVE.url);
    const attempt = start(card, '777');
    expect(await first()).toBe('https://hh.ru/vacancy/777');
    const queued = await h.post('/api/v1/candidate/manual-applications', { vacancyId: card, reason: 'linkedin' }, 'flagged.test');
    expect([queued.statusCode, queued.json().error.code]).toEqual([409, 'hh_apply_in_progress']);
    hh.finishAttempt(h.candidateIds['flagged.test'], attempt, { outcome: 'failed', failureCode: null, now: new Date() });
    expect(await first()).toBe(LIVE.url);
  });
  it('без сессии и без флага — 404', async () => {
    const h = await setup();
    expect((await h.get(`${BASE}/cluster-src-hh-search:139180469`)).statusCode).toBe(404);
    expect((await h.get(`${BASE}/cluster-src-hh-search:139180469`, 'plain.test')).statusCode).toBe(404);
  });
});
