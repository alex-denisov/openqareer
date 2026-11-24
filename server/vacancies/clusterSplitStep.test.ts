import type { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { vacancyKey } from '../../shared/vacancyCatalogRoutes';
import type { UnifiedVacancy } from '../domain/unifiedVacancy';
import { revertClusterSplitStep, splitClustersStep } from './clusterSplitStep';
import { SqliteVacancyPoolStore } from './sqliteVacancyPoolStore';
import {
  clusterKeys,
  createClusterFromVacancy,
  mergeVacancyIntoCluster,
} from './vacancyDeduplicator';

const VK = 'src-fh-vk';
const ORACLE = 'src-fh-oracle';

function vacancy(
  sourceId: string,
  externalId: string,
  company: string,
  title: string,
): UnifiedVacancy {
  const url = `https://${sourceId}.example/jobs/${externalId}`;
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
const vkRef = vacancy(VK, '777', 'VK', 'Data Engineer');
const oracleRef = vacancy(ORACLE, '777', 'Tata Capital', 'Teller');

let store: SqliteVacancyPoolStore | undefined;
afterEach(() => store?.close());

function collided(a: UnifiedVacancy, b: UnifiedVacancy) {
  const cluster = createClusterFromVacancy(a);
  mergeVacancyIntoCluster(cluster, b);
  return cluster;
}

function seed(): { db: DatabaseSync; keptId: string; refId: string } {
  store = new SqliteVacancyPoolStore({ databasePath: ':memory:' });
  const db = (store as unknown as { database: DatabaseSync }).database;
  store.replaceSourceSlice(VK, [vk, vkRef]);
  store.replaceSourceSlice(ORACLE, [oracle, oracleRef]);
  const kept = collided(vk, oracle);
  const referenced = collided(vkRef, oracleRef);
  store.saveClusters([kept, referenced]);
  db.exec('CREATE TABLE IF NOT EXISTS applications (id TEXT PRIMARY KEY, cluster_id TEXT)');
  db.prepare("INSERT INTO applications VALUES ('a1', ?)").run(referenced.id);
  const key = vacancyKey(kept.id);
  db.prepare(
    `INSERT INTO catalog_entries (cluster_id, entry_key, path, title, company, is_remote, summary,
       skills_json, source_url, published_at, last_seen_at, source_count, status, published_ms, last_seen_ms)
     VALUES (?, ?, ?, 't', 'c', 0, 's', '[]', ?, '', '', 2, 'active', 0, 0)
     ON CONFLICT(cluster_id) DO UPDATE SET source_url = excluded.source_url,
       entry_key = excluded.entry_key, path = excluded.path`,
  ).run(kept.id, key, `/vacancies/job/teller-${key}`, oracle.url);
  db.prepare(
    'INSERT OR REPLACE INTO catalog_entries_seen (cluster_id, processed_at) VALUES (?, 1)',
  ).run(kept.id);
  return { db, keptId: kept.id, refId: referenced.id };
}

const AFFECTED = [
  'SELECT rowid, * FROM vacancy_clusters ORDER BY rowid',
  'SELECT * FROM vacancy_cluster_keys ORDER BY cluster_id, kind, key',
  'SELECT rowid, * FROM catalog_entries ORDER BY rowid',
  'SELECT rowid, * FROM catalog_entries_seen ORDER BY rowid',
  'SELECT * FROM vacancy_catalog_redirects ORDER BY old_key',
  'SELECT * FROM cluster_split_pages ORDER BY old_key',
];
const snapshot = (db: DatabaseSync) => AFFECTED.map((sql) => db.prepare(sql).all());

describe('cluster split step (B752)', () => {
  it('splits a collided cluster, moves its catalog page and journals the old state', () => {
    const { db, keptId, refId } = seed();
    const pieceId = `cluster-${oracle.id}`;

    const result = splitClustersStep(db, { chunk: 200, now: 1_000 });

    expect(result).toMatchObject({ scanned: 2, split: 1, pieces: 1, skippedCandidateRef: 1 });
    expect(result.catalogMoved).toBe(1);
    const ids = db.prepare('SELECT id, items_count FROM vacancy_clusters ORDER BY rowid').all();
    expect(ids).toEqual([
      { id: keptId, items_count: 1 },
      { id: refId, items_count: 2 },
      { id: pieceId, items_count: 1 },
    ]);
    const keysOf = (id: string) =>
      db
        .prepare(
          'SELECT kind, key FROM vacancy_cluster_keys WHERE cluster_id = ? ORDER BY kind, key',
        )
        .all(id);
    const piece = JSON.parse(
      (
        db.prepare('SELECT cluster_json FROM vacancy_clusters WHERE id = ?').get(pieceId) as {
          cluster_json: string;
        }
      ).cluster_json,
    );
    expect(keysOf(pieceId)).toHaveLength(
      new Set(clusterKeys(piece).map((k) => `${k.kind}|${k.key}`)).size,
    );
    expect(keysOf(keptId).some((k) => (k as { key: string }).key.includes(ORACLE))).toBe(false);
    // Основатель сохраняет id, а с ним ключ и адрес; кусок получает свою страницу.
    const pages = db
      .prepare(
        `SELECT cluster_id, entry_key, title, source_url, source_count FROM catalog_entries
           WHERE cluster_id IN (?, ?) ORDER BY cluster_id`,
      )
      .all(keptId, pieceId);
    expect(pages).toEqual(
      [
        {
          cluster_id: keptId,
          entry_key: vacancyKey(keptId),
          title: vk.title,
          source_url: vk.url,
          source_count: 1,
        },
        {
          cluster_id: pieceId,
          entry_key: vacancyKey(pieceId),
          title: oracle.title,
          source_url: oracle.url,
          source_count: 1,
        },
      ].sort((a, b) => a.cluster_id.localeCompare(b.cluster_id)),
    );
    expect(
      db.prepare('SELECT cluster_id FROM catalog_entries_seen ORDER BY cluster_id').all(),
    ).toEqual(expect.arrayContaining([{ cluster_id: keptId }, { cluster_id: pieceId }]));
    // На прежней странице стояла ссылка Oracle: её адрес уходит куску Oracle.
    expect(
      db.prepare('SELECT old_key, new_cluster_id, new_key FROM vacancy_catalog_redirects').all(),
    ).toEqual([
      { old_key: vacancyKey(keptId), new_cluster_id: pieceId, new_key: vacancyKey(pieceId) },
    ]);
    expect(db.prepare('SELECT count(*) AS n FROM cluster_split_journal').get()).toEqual({ n: 1 });

    expect(splitClustersStep(db, { chunk: 200, now: 2_000 })).toMatchObject({
      scanned: 1,
      split: 0,
    });
    expect(splitClustersStep(db, { chunk: 200, now: 3_000 })).toMatchObject({ completed: true });
    expect(db.prepare('SELECT completed, clusters_split FROM cluster_split_state').get()).toEqual({
      completed: 1,
      clusters_split: 1,
    });
  });

  it('a reverted step restores every affected table row for row', () => {
    const { db } = seed();
    const before = snapshot(db);

    const result = splitClustersStep(db, { chunk: 200, now: 1_000 });
    expect(snapshot(db)).not.toEqual(before);
    revertClusterSplitStep(db, result.stepId!);

    expect(snapshot(db)).toEqual(before);
    expect(db.prepare('SELECT count(*) AS n FROM cluster_split_journal').get()).toEqual({ n: 0 });
    // Курсор возвращается к откаченному кластеру: следующий шаг разбивает его снова.
    expect(db.prepare('SELECT completed FROM cluster_split_state').get()).toEqual({ completed: 0 });
    expect(splitClustersStep(db, { chunk: 200, now: 4_000 })).toMatchObject({ split: 1 });
  });
});
