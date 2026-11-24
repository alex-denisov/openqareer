import type { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { vacancyKey, vacancyPath } from '../../shared/vacancyCatalogRoutes';
import type { UnifiedVacancy } from '../domain/unifiedVacancy';
import { pageOwner } from './clusterSplitPages';
import { revertClusterSplitStep, splitClustersStep } from './clusterSplitStep';
import { SqliteVacancyPoolStore } from './sqliteVacancyPoolStore';
import { createClusterFromVacancy, mergeVacancyIntoCluster } from './vacancyDeduplicator';

/** B752: опубликованный адрес после разбиения ведёт на ту же вакансию или снят. */

function vacancy(sourceId: string, company: string, title: string): UnifiedVacancy {
  const sourceUrl = `https://${sourceId}.example/api/55418`;
  return {
    id: `${sourceId}:55418`,
    fingerprint: `fp-${sourceId}`,
    title,
    company,
    description: `${title} at ${company}`,
    requiredSkills: ['Go'],
    // Ссылка страницы — адрес вакансии, не `sourceUrl` площадки.
    url: `https://${sourceId}.example/jobs/55418`,
    provenance: {
      sourceType: 'json_api',
      sourceId,
      sourceUrl,
      externalId: '55418',
      observedAt: '2026-11-01T00:00:00.000Z',
    },
    publishedAt: '2026-11-01T00:00:00.000Z',
    status: 'active',
  };
}

const stores: SqliteVacancyPoolStore[] = [];
afterEach(() => stores.splice(0).forEach((store) => store.close()));

interface Seed {
  readonly founder?: UnifiedVacancy;
  readonly other?: UnifiedVacancy;
  readonly link: string;
  /** Имя на опубликованной странице. */
  readonly title?: string;
}

const VK = vacancy('src-fh-vk', 'VK', 'Go Developer');
/** Площадка того же ранга, что у основателя: ссылка карточки остаётся за ним. */
const PEER = vacancy('src-w', 'Tata Capital', 'Relationship Manager');
const TATA = vacancy('src-fh-oracle', 'Tata Capital', 'Relationship Manager');

function seed({ founder = VK, other = TATA, link, title = 'Teller' }: Seed) {
  const store = new SqliteVacancyPoolStore({ databasePath: ':memory:' });
  stores.push(store);
  const db = (store as unknown as { database: DatabaseSync }).database;
  store.replaceSourceSlice(founder.provenance.sourceId, [founder]);
  store.replaceSourceSlice(other.provenance.sourceId, [other]);
  const cluster = createClusterFromVacancy(founder);
  mergeVacancyIntoCluster(cluster, other);
  store.saveClusters([cluster]);
  const path = vacancyPath({ id: cluster.id, title, company: 'Bank' })!;
  db.prepare(
    `INSERT OR REPLACE INTO catalog_entries (cluster_id, entry_key, path, title, company, is_remote,
       summary, skills_json, source_url, published_at, last_seen_at, source_count, status,
       published_ms, last_seen_ms)
     VALUES (?, ?, ?, ?, 'Bank', 0, 's', '[]', ?, '', '', 2, 'active', 0, 0)`,
  ).run(cluster.id, vacancyKey(cluster.id), path, title, link);
  return { store, db, id: cluster.id, pieceId: `cluster-${other.id}`, path };
}

const TABLES = [
  'SELECT rowid, * FROM vacancy_clusters ORDER BY rowid',
  'SELECT * FROM vacancy_cluster_keys ORDER BY cluster_id, kind, key',
  'SELECT rowid, * FROM catalog_entries ORDER BY rowid',
  'SELECT rowid, * FROM catalog_entries_seen ORDER BY rowid',
  'SELECT * FROM vacancy_catalog_redirects',
  'SELECT * FROM cluster_split_pages',
];
const snapshot = (db: DatabaseSync) => TABLES.map((sql) => db.prepare(sql).all());
const redirects = (db: DatabaseSync) =>
  db.prepare('SELECT old_path, new_cluster_id, new_key FROM vacancy_catalog_redirects').all();
const outcomes = (db: DatabaseSync) =>
  db.prepare('SELECT old_path, outcome FROM cluster_split_pages').all();
const pathOf = (db: DatabaseSync, id: string) =>
  (
    db.prepare('SELECT path FROM catalog_entries WHERE cluster_id = ?').get(id) as
      { path: string } | undefined
  )?.path;

/** Шаг, проверка, откат строка в строку — для каждого случая. */
function splitThenRevert(world: ReturnType<typeof seed>, check: (pages: unknown) => void): void {
  const before = snapshot(world.db);
  const result = splitClustersStep(world.db, { now: 1_000 });
  expect(result).toMatchObject({ split: 1, pages: { unresolved: 0 } });
  check(result.pages);
  revertClusterSplitStep(world.db, result.stepId!);
  expect(snapshot(world.db)).toEqual(before);
}

describe('B752: published page addresses after a split', () => {
  it('the link belongs to the founder — the address stays with it', () => {
    const world = seed({ link: VK.url });
    splitThenRevert(world, (pages) => {
      expect(pages).toMatchObject({ kept: 1 });
      expect(redirects(world.db)).toEqual([]);
    });
  });

  it('the link belongs to a piece — the address redirects to its page', () => {
    const world = seed({ link: TATA.url });
    splitThenRevert(world, () => {
      expect(redirects(world.db)).toEqual([
        { old_path: world.path, new_cluster_id: world.pieceId, new_key: vacancyKey(world.pieceId) },
      ]);
      expect(outcomes(world.db)).toEqual([{ old_path: world.path, outcome: 'redirect' }]);
      expect(pathOf(world.db, world.id)).not.toBe(world.path);
    });
  });

  it('no piece owns the link — the address is gone, not another vacancy', () => {
    const world = seed({ link: 'https://elsewhere.example/9' });
    splitThenRevert(world, () => {
      expect(redirects(world.db)).toEqual([
        { old_path: world.path, new_cluster_id: '', new_key: '' },
      ]);
      expect(outcomes(world.db)).toEqual([{ old_path: world.path, outcome: 'gone' }]);
    });
  });

  it('the owner piece cannot have a page — the address is gone', () => {
    const other = vacancy('src-fh-oracle', 'Тата', 'Шлифовщик зеркал');
    const world = seed({ other, link: other.url });
    splitThenRevert(world, () => {
      expect(redirects(world.db)).toEqual([
        { old_path: world.path, new_cluster_id: world.pieceId, new_key: '' },
      ]);
      expect(outcomes(world.db)).toEqual([{ old_path: world.path, outcome: 'gone' }]);
    });
  });

  it('the founder loses its page — the address is gone, never left without a record', () => {
    const founder = vacancy('src-fh-vk', 'ВК', 'Шлифовщик зеркал');
    const world = seed({ founder, link: founder.url });
    splitThenRevert(world, () => {
      expect(pathOf(world.db, world.id)).toBeUndefined();
      expect(outcomes(world.db)).toEqual([{ old_path: world.path, outcome: 'gone' }]);
    });
  });

  it('the same path never goes back to the founder, not even on its next projection', () => {
    const founder = vacancy('src-fh-vk', 'Bank', 'Teller');
    const world = seed({ founder, link: TATA.url });
    splitThenRevert(world, () => {
      expect(pathOf(world.db, world.id)).toBeUndefined();
      world.store.saveClusters([world.store.getCluster(world.id)!]);
      expect(pathOf(world.db, world.id)).toBeUndefined();
      expect(outcomes(world.db)).toEqual([{ old_path: world.path, outcome: 'redirect' }]);
    });
  });

  it('the founder record is stored under another id — the cluster and its page stay with it', () => {
    const founder = {
      ...vacancy('dou-geniusee', 'Geniusee', 'Go Architect'),
      id: 'dou-geniusee-55418',
    };
    const world = seed({ founder, other: PEER, link: founder.url });
    splitThenRevert(world, (pages) => {
      expect(pages).toMatchObject({ kept: 1 });
      const own = world.store.getCluster(world.id)!;
      expect(own).toMatchObject({ canonicalTitle: 'Go Architect', vacanciesCount: 1 });
      expect(own.sources).toHaveLength(1);
    });
  });

  it('the founder record dropped out of the sources — its page stays with it', () => {
    const founder = vacancy('src-x', 'Summize', 'Legal Engineer');
    const world = seed({ founder, other: PEER, link: founder.url });
    const extra = vacancy('src-y', 'VIPcare', 'Office Manager');
    world.store.replaceSourceSlice('src-y', [extra]);
    const cluster = world.store.getCluster(world.id)!;
    world.db
      .prepare('UPDATE vacancy_clusters SET cluster_json = ? WHERE id = ?')
      .run(JSON.stringify({ ...cluster, sources: [PEER.provenance, extra.provenance] }), world.id);
    splitThenRevert(world, (pages) => {
      expect(pages).toMatchObject({ kept: 1 });
      expect(world.store.getCluster(world.id)!.canonicalTitle).toBe('Legal Engineer');
    });
  });

  it('a withdrawn founder record is not brought back', () => {
    const founder = { ...vacancy('src-x', 'Summize', 'Legal Engineer'), id: 'src-x-55418' };
    const world = seed({ founder, other: PEER, link: founder.url });
    const other = vacancy('src-y', 'VIPcare', 'Office Manager');
    world.store.replaceSourceSlice('src-y', [other]);
    const cluster = world.store.getCluster(world.id)!;
    world.db
      .prepare('UPDATE vacancy_clusters SET cluster_json = ? WHERE id = ?')
      .run(
        JSON.stringify({ ...cluster, sources: [...cluster.sources, other.provenance] }),
        world.id,
      );
    world.db
      .prepare("UPDATE vacancy_pool SET expired_at = '2026-11-20' WHERE id = ?")
      .run(founder.id);
    splitThenRevert(world, (pages) => expect(pages).toMatchObject({ gone: 1 }));
  });

  it('another cluster holds the same link and title — the address redirects to it', () => {
    const outside = vacancy('src-z', 'Fulton Bank', 'Mortgage Officer');
    const world = seed({ link: outside.url, title: 'Mortgage Officer' });
    world.store.saveClusters([createClusterFromVacancy(outside)]);
    splitThenRevert(world, (pages) => {
      expect(pages).toMatchObject({ redirect: 1 });
      expect(redirects(world.db)).toMatchObject([{ new_cluster_id: `cluster-${outside.id}` }]);
    });
  });

  it('another cluster with the same link but another title is not a guess', () => {
    const outside = vacancy('src-z', 'Fulton Bank', 'Mortgage Officer');
    const world = seed({ link: outside.url, title: 'Teller' });
    world.store.saveClusters([createClusterFromVacancy(outside)]);
    splitThenRevert(world, (pages) => expect(pages).toMatchObject({ gone: 1 }));
  });
});

describe('B752: one link at two pieces', () => {
  const pieces = [
    { ...createClusterFromVacancy(VK), primaryUrl: 'https://a.example/1' },
    { ...createClusterFromVacancy(TATA), primaryUrl: 'https://a.example/1' },
  ];
  const links = new Map([['https://a.example/1', new Set([0, 1])]]);
  const owner = (title: string, company: string) =>
    pageOwner(
      { entry_key: 'k', path: '/p', title, company, source_url: 'https://a.example/1' },
      pieces,
      links,
    );

  it.each([
    ['Relationship Manager', 'Tata Capital', 1],
    ['Relationship Manager', 'Renamed Ltd', 1],
    ['Renamed role', 'VK', 0],
    ['Renamed role', 'Renamed Ltd', undefined],
  ])('%s / %s → %s', (title, company, expected) => {
    expect(owner(title, company)).toBe(expected);
  });
});
