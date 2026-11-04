import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UnifiedVacancy } from '../domain/unifiedVacancy';
import { watchWriteHolds } from '../observability/sqliteWriteHolds';
import { CLUSTER_WRITE_GAP_MS, pauseClusterWrite } from './clusterWritePause';
import { clusterBatchByKeys } from './keyedClusterer';
import { SqliteVacancyPoolStore } from './sqliteVacancyPoolStore';
import { clusterVacancies } from './vacancyDeduplicator';
import { clusterProjectionOf } from './vacancyPoolQuery';

const TEXT = [
  'Ищем директора, который выстроит операционные процессы сети и отвечает за результат.',
  'Задачи: управлять командой, отвечать за P&L, запускать новые точки, внедрять стандарты.',
  'Требования: опыт руководства в ритейле от пяти лет, управление сетью, работа с метриками.',
  'Условия: доход из оклада и бонуса, официальное оформление, командировки по регионам.',
  'Мы развиваем сеть магазинов у дома в нескольких регионах и готовимся к новому этапу роста.',
].join(' ');

function hh(id: string, company: string, title = 'Операционный директор', over: Partial<UnifiedVacancy> = {}) {
  const url = `https://hh.ru/vacancy/${id}`;
  const vacancy: UnifiedVacancy = {
    id: `src-hh-search:${id}`,
    fingerprint: `src-hh-search:${id}`,
    title,
    company,
    location: 'Москва',
    description: '',
    requiredSkills: [],
    url,
    provenance: {
      sourceType: 'hh',
      sourceId: 'src-hh-search',
      externalId: id,
      sourceUrl: url,
      observedAt: '2026-11-01T04:49:34.596Z',
    },
    publishedAt: '2026-11-01T04:49:34.596Z',
    status: 'active',
    ...over,
  };
  return vacancy;
}

const COMPANIES = ['Альфа', 'Берёза', 'Вектор', 'Гранит'];
const TITLES = ['Повар', 'Юрист', 'Водитель', 'Бухгалтер'];
const distinct = (size: number) =>
  Array.from({ length: size }, (_, index) => hh(`9${index}`, COMPANIES[index]!, TITLES[index]!));

const unwatch: Array<() => void> = [];
afterEach(() => {
  unwatch.splice(0).forEach((stop) => stop());
  vi.restoreAllMocks();
});

/** Calls back after every commit of a write transaction: what any other connection may see next. */
function afterEachCommit(onCommit: (statement: string) => void): void {
  unwatch.push(watchWriteHolds((hold) => onCommit(hold.statement), 0));
}

describe('cluster write in short transactions (PRB-041)', () => {
  it('commits at the time budget and pauses between transactions, not after the last', () => {
    const pause = vi.fn();
    const store = new SqliteVacancyPoolStore({ databasePath: ':memory:', writeBudgetMs: 0, clusterWritePause: pause });
    const commits: string[] = [];
    afterEachCommit((statement) => commits.push(statement));

    store.saveClusters(clusterVacancies(distinct(3)));

    expect(commits).toEqual(Array(3).fill('INSERT INTO vacancy_clusters'));
    expect(pause).toHaveBeenCalledTimes(2);
    expect(store.countClusters()).toBe(3);
  });

  it('inside the budget a batch is one transaction and no pause', () => {
    const pause = vi.fn();
    const store = new SqliteVacancyPoolStore({ databasePath: ':memory:', writeBudgetMs: 60_000, clusterWritePause: pause });
    const commits: string[] = [];
    afterEachCommit((statement) => commits.push(statement));

    store.saveClusters(clusterVacancies(distinct(3)));

    expect(commits).toHaveLength(1);
    expect(pause).not.toHaveBeenCalled();
  });

  it('a cluster row, its catalog entry and its keys land together: a failure leaves no half of a cluster', () => {
    const store = new SqliteVacancyPoolStore({ databasePath: ':memory:', writeBudgetMs: 0 });
    const [first, second] = clusterVacancies(distinct(2));
    const keys = store as never as { writeClusterKeys(...args: unknown[]): void };
    const original = keys.writeClusterKeys;
    let calls = 0;
    vi.spyOn(keys, 'writeClusterKeys').mockImplementation(function (this: unknown, ...args: unknown[]) {
      calls += 1;
      if (calls === 2) throw new Error('busy');
      return original.apply(this, args);
    });

    expect(() => store.saveClusters([first!, second!])).toThrow('busy');

    expect(store.getCluster(first!.id)).toBeDefined();
    expect(store.getCluster(second!.id)).toBeUndefined();
    expect(store.pendingCatalogEntries()).toBe(0);
  });

  it('a batch that failed halfway and runs again gives what one run gives: no doubled membership', () => {
    const batch = distinct(4);
    const again = new SqliteVacancyPoolStore({ databasePath: ':memory:', writeBudgetMs: 0 });
    const clean = new SqliteVacancyPoolStore({ databasePath: ':memory:' });
    vi.spyOn(again, 'saveClusters').mockImplementationOnce(function (this: SqliteVacancyPoolStore, clusters) {
      SqliteVacancyPoolStore.prototype.saveClusters.call(this, clusters.slice(0, 2));
      throw new Error('crash between transactions');
    });

    expect(() => clusterBatchByKeys(again, batch.map(clusterProjectionOf))).toThrow('crash');
    clusterBatchByKeys(again, batch.map(clusterProjectionOf));
    clusterBatchByKeys(clean, batch.map(clusterProjectionOf));

    const shape = (store: SqliteVacancyPoolStore) =>
      store.loadClusters().map((cluster) => [cluster.id, cluster.vacanciesCount]).sort();
    expect(shape(again)).toEqual(shape(clean));
  });

  it('the pause really waits: on a loaded machine a 100 ms gap is what lets another process in', () => {
    const startedAt = performance.now();
    pauseClusterWrite();
    expect(performance.now() - startedAt).toBeGreaterThanOrEqual(CLUSTER_WRITE_GAP_MS - 1);
  });

  it('no commit shows a vacancy in two clusters while twins are absorbed', () => {
    const store = new SqliteVacancyPoolStore({ databasePath: ':memory:', writeBudgetMs: 0 });
    const withoutText = [
      hh('900494', 'Магазин Радости'),
      hh('900495', 'Магазин Радости'),
      hh('900283', 'МАГАЗИН СЧАСТЬЯ'),
      hh('900284', 'МАГАЗИН СЧАСТЬЯ'),
    ];
    store.mergeSourceSlice('src-hh-search', withoutText);
    clusterBatchByKeys(store, withoutText.map(clusterProjectionOf));
    expect(store.countClusters()).toBe(2);

    const seenTwice: string[][] = [];
    afterEachCommit(() => {
      const members = store.loadClusters().flatMap((cluster) => cluster.sources.map((source) => source.externalId ?? ''));
      const repeated = members.filter((member, index) => members.indexOf(member) !== index);
      if (repeated.length > 0) seenTwice.push(repeated);
    });
    const withText = withoutText.map((vacancy) => ({ ...vacancy, fullDescription: TEXT }));
    store.mergeSourceSlice('src-hh-search', withText);
    clusterBatchByKeys(store, withText.map(clusterProjectionOf));

    expect(seenTwice).toEqual([]);
    expect(store.countClusters()).toBe(1);
    expect(store.loadClusters()[0]!.vacanciesCount).toBe(4);
  });
});
