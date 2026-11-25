import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type { UnifiedVacancy, VacancyCluster } from '../domain/unifiedVacancy';
import {
  droppedSources,
  hasCrossSourceIdCollision,
  planClusterSplit,
  runClusterSplitDryRun,
} from './clusterSplit';
import { SqliteVacancyPoolStore } from './sqliteVacancyPoolStore';
import { createClusterFromVacancy, mergeVacancyIntoCluster } from './vacancyDeduplicator';

const VK = 'src-fh-vk';
const ORACLE = 'src-fh-oracle-eofh-fa-em2-oraclecloud-com-cx-3001';

function vacancy(
  sourceId: string,
  externalId: string,
  company: string,
  title: string,
  url = `https://${sourceId}.example/jobs/${externalId}`,
): UnifiedVacancy {
  return {
    id: `${sourceId}:${externalId}`,
    fingerprint: `fp-${sourceId}-${externalId}`,
    title,
    company,
    description: `${title} at ${company}`,
    requiredSkills: ['Go'],
    url,
    provenance: {
      sourceType: 'json_api',
      sourceId,
      sourceUrl: url,
      externalId,
      observedAt: '2026-11-01T00:00:00.000Z',
    },
    publishedAt: '2026-11-01T00:00:00.000Z',
    status: 'active',
  };
}

const vk = vacancy(VK, '55418', 'VK', 'Go Developer');
const oracle = vacancy(ORACLE, '55418', 'Tata Capital', 'Relationship Manager');

/** Кластер, склеенный голым id до B752: основатель VK, член Oracle. */
function collided(): VacancyCluster {
  const cluster = createClusterFromVacancy(vk);
  mergeVacancyIntoCluster(cluster, oracle);
  return cluster;
}

const byId = (...items: UnifiedVacancy[]) => new Map(items.map((item) => [item.id, item]));

describe('cluster split planner (B752)', () => {
  it('detects only clusters where one external id spans two sources', () => {
    expect(hasCrossSourceIdCollision(collided())).toBe(true);
    expect(hasCrossSourceIdCollision(createClusterFromVacancy(vk))).toBe(false);
  });

  it('splits a collided cluster; the founder keeps the id', () => {
    const pieces = planClusterSplit(collided(), byId(vk, oracle));
    expect(pieces.map((piece) => piece.id)).toEqual([
      `cluster-${VK}:55418`,
      `cluster-${ORACLE}:55418`,
    ]);
    expect(pieces.map((piece) => piece.vacanciesCount)).toEqual([1, 1]);
    expect(pieces[1]!.canonicalCompany).toBe('Tata Capital');
  });

  it('keeps a legitimate same-url duplicate together', () => {
    const url = 'https://jobs.acme.example/55418';
    const ats = vacancy('src-ats', '55418', 'Acme', 'QA Engineer', url);
    const site = vacancy('src-site', '55418', 'Acme', 'QA Engineer', url);
    const cluster = createClusterFromVacancy(ats);
    mergeVacancyIntoCluster(cluster, site);
    expect(hasCrossSourceIdCollision(cluster)).toBe(true);
    expect(planClusterSplit(cluster, byId(ats, site))).toEqual([cluster]);
  });

  it('drops a foreign source without a pool record, a lone founder too', () => {
    const [founder, ...rest] = planClusterSplit(collided(), byId(vk));
    expect(rest).toEqual([]);
    expect(founder).toMatchObject({ id: `cluster-${VK}:55418`, vacanciesCount: 1 });
    expect(founder!.sources.map((source) => source.sourceId)).toEqual([VK]);
  });

  it('drops a foreign orphan and still splits the rest', () => {
    const orphan = vacancy('ats-orphan', '55418', 'Acrylicize', 'Artist');
    const cluster = collided();
    mergeVacancyIntoCluster(cluster, orphan);
    const pieces = planClusterSplit(cluster, byId(vk, oracle));
    expect(pieces.flatMap((piece) => piece.sources.map((s) => s.sourceId))).toEqual([VK, ORACLE]);
    expect(droppedSources(cluster, pieces).map((s) => s.sourceId)).toEqual(['ats-orphan']);
  });

  it('keeps the orphan of the same vacancy: own host, or a number nobody else has', () => {
    const site = vacancy('src-site', '55418', 'VK', 'Go Developer', 'https://src-fh-vk.example/x');
    const unique = vacancy('src-other', '90001', 'VK', 'Go Developer');
    const cluster = collided();
    mergeVacancyIntoCluster(cluster, site);
    mergeVacancyIntoCluster(cluster, unique);
    const [founder] = planClusterSplit(cluster, byId(vk, oracle));
    expect(founder!.sources.map((s) => s.sourceId)).toEqual([VK, 'src-site', 'src-other']);
  });

  it('leaves the cluster alone when no record is in the pool', () => {
    const cluster = collided();
    expect(planClusterSplit(cluster, new Map())).toEqual([cluster]);
  });
});

describe('cluster split dry run (B752)', () => {
  it('counts splits, catalog moves and candidate-ref skips without writing', () => {
    const store = new SqliteVacancyPoolStore({ databasePath: ':memory:' });
    const database = (store as unknown as { database: DatabaseSync }).database;
    const kept = collided();
    const vkReferenced = vacancy(VK, '777', 'VK', 'Data Engineer');
    const oracleReferenced = vacancy(ORACLE, '777', 'Tata Capital', 'Teller');
    store.replaceSourceSlice(VK, [vk, vkReferenced]);
    store.replaceSourceSlice(ORACLE, [oracle, oracleReferenced]);
    const referenced = createClusterFromVacancy(vkReferenced);
    mergeVacancyIntoCluster(referenced, oracleReferenced);
    store.saveClusters([kept, referenced]);
    database.exec('CREATE TABLE IF NOT EXISTS applications (id TEXT PRIMARY KEY, cluster_id TEXT)');
    database
      .prepare('INSERT INTO applications (id, cluster_id) VALUES (?, ?)')
      .run('a1', referenced.id);
    database
      .prepare(
        `INSERT INTO catalog_entries (cluster_id, entry_key, path, title, company, is_remote, summary,
           skills_json, source_url, published_at, last_seen_at, source_count, status, published_ms, last_seen_ms)
         VALUES (?, 'k1', '/vacancies/k1', 't', 'c', 0, 's', '[]', ?, '', '', 2, 'active', 0, 0)
         ON CONFLICT(cluster_id) DO UPDATE SET source_url = excluded.source_url`,
      )
      .run(kept.id, oracle.url);
    const before = database.prepare('SELECT count(*) AS n FROM vacancy_clusters').get();

    const counts = runClusterSplitDryRun(database);

    expect(counts).toMatchObject({
      clustersScanned: 2,
      clustersCollided: 2,
      clustersSplit: 1,
      piecesCreated: 1,
      catalogMoved: 1,
      skippedCandidateRef: 1,
      redirects: 1,
    });
    expect(counts.journalBytesEstimate).toBeGreaterThan(0);
    expect(counts.keysRewritten).toBeGreaterThan(0);
    expect(database.prepare('SELECT count(*) AS n FROM vacancy_clusters').get()).toEqual(before);
    store.close();
  });

  it('counts split clusters with requirements by the vacancy id the cache is keyed on', () => {
    const store = new SqliteVacancyPoolStore({ databasePath: ':memory:' });
    const database = (store as unknown as { database: DatabaseSync }).database;
    const kept = collided();
    store.replaceSourceSlice(VK, [vk]);
    store.replaceSourceSlice(ORACLE, [oracle]);
    store.saveClusters([kept]);
    database.exec(`CREATE TABLE vacancy_requirements_cache (
      cache_key TEXT PRIMARY KEY, vacancy_id TEXT NOT NULL, cluster_id TEXT,
      description_hash TEXT NOT NULL, extractor_version TEXT NOT NULL,
      result_json TEXT NOT NULL, updated_at INTEGER NOT NULL)`);
    // На проде cluster_id пуст у всех строк: кэш пишется по vacancy_id = id кластера.
    database
      .prepare(`INSERT INTO vacancy_requirements_cache VALUES ('k', ?, NULL, 'h', 'v', '{}', 0)`)
      .run(kept.id);

    expect(runClusterSplitDryRun(database)).toMatchObject({
      splitWithRequirements: 1,
      piecesWithRequirements: 1,
    });
    store.close();
  });
});
