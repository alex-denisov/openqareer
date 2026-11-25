import { afterEach, describe, expect, it } from 'vitest';
import type { UnifiedVacancy, VacancySourceConfig } from '../domain/unifiedVacancy';
import { HhVacancyDescriptionLoader } from './hhVacancyDescription';
import { MultiSourceVacancyEngine } from './multiSourceVacancyEngine';
import { LIVENESS_PER_TICK, LIVENESS_RECHECK_MS, runSelectionLiveness } from './selectionLiveness';
import { SqliteVacancyPoolStore } from './sqliteVacancyPoolStore';
import { DEFAULT_VACANCY_SOURCES } from './defaultVacancySources';
import { UNKNOWN_PUBLISHED_AT } from './jsonVacancyRecord';
import { absorbCluster, createClusterFromVacancy } from './vacancyDeduplicator';

const HH = 'src-hh-search';
const ARCHIVED = '{"status":{"archived":true}}';
const OPEN = '<div data-qa="vacancy-description"><p>Текст вакансии на Python</p></div>';
const stores: SqliteVacancyPoolStore[] = [];
afterEach(() => stores.splice(0).forEach((store) => store.close()));

function openStore(): SqliteVacancyPoolStore {
  const store = new SqliteVacancyPoolStore({ databasePath: ':memory:' });
  stores.push(store);
  return store;
}

function vacancy(id: string, sourceId: string, url: string): UnifiedVacancy {
  const at = new Date(Date.now() - 86_400_000).toISOString();
  return {
    id,
    fingerprint: id,
    title: `Роль ${id}`,
    company: `Компания ${id}`,
    description: '',
    fullDescription: 'Давно прочитанный текст',
    requiredSkills: [],
    url,
    provenance: {
      sourceType: sourceId === HH ? 'hh_search' : 'rss',
      sourceId,
      sourceUrl: url,
      observedAt: at,
    } as UnifiedVacancy['provenance'],
    publishedAt: at,
    status: 'active',
  };
}
const hh = (n: number) => vacancy(`${HH}:${n}`, HH, `https://hh.ru/vacancy/${n}`);

function engineOf(
  pool: SqliteVacancyPoolStore,
  answer: (url: string) => { status: number; body: string },
) {
  const hhSource = DEFAULT_VACANCY_SOURCES.find((source) => source.id === HH)!;
  const other = { ...hhSource, id: 'src-other', type: 'rss' } as VacancySourceConfig;
  const asked: string[] = [];
  const engine = new MultiSourceVacancyEngine({
    sources: [hhSource, other],
    pool,
    descriptionLoader: new HhVacancyDescriptionLoader({
      transport: async (url) => {
        asked.push(url);
        return answer(url);
      },
      sleep: async () => undefined,
    }),
    linkProbe: async (url) => {
      asked.push(url);
      return { status: 404 };
    },
    recluster: { mode: 'keyed', batchSize: 100 },
  });
  return { engine, asked };
}
const step = (engine: MultiSourceVacancyEngine) => engine.runSelectionLivenessStep(() => false);

describe('B797: сверка живости верха подборок', () => {
  it('архивная hh с прочитанным текстом уходит из пула и кластера, открытая остаётся', async () => {
    const pool = openStore();
    pool.mergeSourceSlice(HH, [hh(1), hh(2)]);
    pool.saveClusters([hh(1), hh(2)].map(createClusterFromVacancy));
    const { engine } = engineOf(pool, (url) => ({
      status: 200,
      body: url.endsWith('/1') ? ARCHIVED : OPEN,
    }));
    engine.requestSelectionLiveness([`${HH}:1`, `${HH}:2`]);
    expect(await step(engine)).toEqual({ checked: 2, gone: 1, open: 1, unknown: 0 });
    expect(pool.getVacancy(`${HH}:1`)).toBeUndefined();
    expect(pool.getVacancy(`${HH}:2`)).toBeDefined();
    expect(pool.getCluster(`cluster-${HH}:1`)?.status).not.toBe('active');
    expect(engine.isKnownVacancyGone(`cluster-${HH}:1`)).toBe(true);
    expect(await step(engine)).toMatchObject({ checked: 0 });
  });

  it('снятая ссылка другой площадки уходит тоже', async () => {
    const pool = openStore();
    pool.mergeSourceSlice('src-other', [vacancy('x:1', 'src-other', 'https://jobs.example.com/1')]);
    const { engine } = engineOf(pool, () => ({ status: 200, body: OPEN }));
    engine.requestSelectionLiveness(['x:1']);
    expect(await step(engine)).toMatchObject({ gone: 1 });
    expect(pool.getVacancy('x:1')).toBeUndefined();
  });

  it('отказ площадки обрывает такт и не тратит очередь', async () => {
    const pool = openStore();
    pool.mergeSourceSlice(HH, [hh(1), hh(2)]);
    const { engine, asked } = engineOf(pool, () => ({ status: 429, body: '' }));
    engine.requestSelectionLiveness([`${HH}:1`, `${HH}:2`]);
    expect(await step(engine)).toEqual({ checked: 0, gone: 0, open: 0, unknown: 0, blocked: true });
    expect(asked).toHaveLength(1);
    expect(pool.dueSelectionLiveness(10)).toHaveLength(2);
  });

  it('одна вакансия — раз в сутки, по новой читает площадку, а не память', async () => {
    const pool = openStore();
    pool.mergeSourceSlice(HH, [hh(1)]);
    let body = OPEN;
    const { engine, asked } = engineOf(pool, () => ({ status: 200, body }));
    engine.requestSelectionLiveness([`${HH}:1`]);
    await step(engine);
    pool.markSelectionLivenessChecked(`${HH}:1`, Date.now() - LIVENESS_RECHECK_MS - 1);
    body = ARCHIVED;
    expect(await step(engine)).toMatchObject({ gone: 1 });
    expect(asked).toHaveLength(2);
  });

  it('порядок: место в подборке; остановка прерывает такт', async () => {
    const pool = openStore();
    const rows = Array.from({ length: 8 }, (_, n) => hh(n + 1));
    pool.mergeSourceSlice(HH, rows);
    pool.requestSelectionLiveness(rows.map((row) => row.id).reverse());
    expect(pool.dueSelectionLiveness(LIVENESS_PER_TICK)[0]).toBe(`${HH}:8`);
    const { engine, asked } = engineOf(pool, () => ({ status: 200, body: OPEN }));
    await engine.runSelectionLivenessStep(() => true);
    expect(asked).toEqual([]);
    const report = await step(engine);
    expect(report.checked).toBe(LIVENESS_PER_TICK);
  });

  it('свежая строка повторно не пишется', () => {
    const pool = openStore();
    pool.mergeSourceSlice(HH, [hh(1), hh(2)]);
    pool.requestSelectionLiveness([`${HH}:1`]);
    pool.requestSelectionLiveness([`${HH}:2`, `${HH}:1`]);
    expect(pool.dueSelectionLiveness(10)).toEqual(expect.arrayContaining([`${HH}:1`, `${HH}:2`]));
  });

  it('шаг без очереди ничего не делает', async () => {
    const report = await runSelectionLiveness({
      due: () => [],
      check: async () => 'open',
      retire: () => undefined,
      markChecked: () => undefined,
      stopped: () => false,
    });
    expect(report.checked).toBe(0);
  });
});

describe('B797: лента без даты (Pinpoint)', () => {
  it('нулевая дата не становится датой карточки и уступает известной', () => {
    const row = hh(1);
    const cluster = createClusterFromVacancy({ ...row, publishedAt: UNKNOWN_PUBLISHED_AT });
    expect(cluster.firstObservedAt).toBe(row.provenance.observedAt);
    const old = {
      ...cluster,
      sources: [...cluster.sources],
      firstObservedAt: UNKNOWN_PUBLISHED_AT,
    };
    absorbCluster(old, createClusterFromVacancy(hh(2)));
    expect(old.firstObservedAt).not.toBe(UNKNOWN_PUBLISHED_AT);
  });
});
