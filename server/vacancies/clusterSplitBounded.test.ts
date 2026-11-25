import type { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import type { UnifiedVacancy } from '../domain/unifiedVacancy';
import { revertClusterSplitChunk } from './clusterSplitRevert';
import { revertClusterSplitStep, splitClustersStep } from './clusterSplitStep';
import { SqliteVacancyPoolStore } from './sqliteVacancyPoolStore';
import { createClusterFromVacancy, mergeVacancyIntoCluster } from './vacancyDeduplicator';

/**
 * B752: шаг держит запись не дольше бюджета. Большой кластер пишется частями:
 * сначала куски, основатель последним — между частями читатель видит дубль,
 * но не дыру; итог тот же, что у одного шага без бюджета.
 */

const SOURCES = ['src-a', 'src-b', 'src-c', 'src-d', 'src-e', 'src-f'];
const COMPANIES = ['Orion', 'Vega', 'Lyra', 'Draco', 'Hydra', 'Cygnus', 'Pavo'];

function vacancy(sourceId: string, externalId: string, company: string): UnifiedVacancy {
  const url = `https://${sourceId}.example/jobs/${externalId}`;
  return {
    id: `${sourceId}:${externalId}`,
    fingerprint: `fp-${sourceId}-${externalId}`,
    title: `Role at ${company}`,
    company,
    description: `Role at ${company}`,
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

const stores: SqliteVacancyPoolStore[] = [];
afterEach(() => stores.splice(0).forEach((store) => store.close()));

function glued(vacancies: readonly UnifiedVacancy[]) {
  const cluster = createClusterFromVacancy(vacancies[0]!);
  for (const other of vacancies.slice(1)) mergeVacancyIntoCluster(cluster, other);
  return cluster;
}

/** Один кластер из шести площадок с одним внешним id: шесть кусков. Плюс два малых кластера. */
function seed(): DatabaseSync {
  const store = new SqliteVacancyPoolStore({ databasePath: ':memory:' });
  stores.push(store);
  const db = (store as unknown as { database: DatabaseSync }).database;
  const big = SOURCES.map((source, index) => vacancy(source, '1', COMPANIES[index]!));
  const small = [vacancy('src-a', '2', 'Alpha'), vacancy('src-b', '2', 'Beta')];
  const tail = [vacancy('src-c', '3', 'Gamma'), vacancy('src-d', '3', 'Delta')];
  for (const source of SOURCES) {
    store.replaceSourceSlice(
      source,
      [...big, ...small, ...tail].filter((item) => item.provenance.sourceId === source),
    );
  }
  store.saveClusters([glued(big), glued(small), glued(tail)]);
  return db;
}

const bigId = 'cluster-src-a:1';

const END_STATE = [
  'SELECT id, title, company, cluster_json, items_count, representative FROM vacancy_clusters ORDER BY id',
  'SELECT * FROM vacancy_cluster_keys ORDER BY cluster_id, kind, key',
  'SELECT cluster_id, entry_key, path, title, source_url, source_count FROM catalog_entries ORDER BY cluster_id',
  'SELECT old_key, new_cluster_id, new_key FROM vacancy_catalog_redirects ORDER BY old_key',
  'SELECT completed, clusters_split, pieces_created FROM cluster_split_state',
];
const endState = (db: DatabaseSync) => END_STATE.map((sql) => db.prepare(sql).all());

function runToEnd(db: DatabaseSync, options: Parameters<typeof splitClustersStep>[1]) {
  const steps = [];
  for (let at = 1; at < 100; at += 1) {
    const step = splitClustersStep(db, { now: 1_000, ...options });
    if (step.completed) return steps;
    steps.push(step);
  }
  throw new Error('split did not finish');
}

const jsonOf = (db: DatabaseSync, id: string) =>
  (
    db.prepare('SELECT cluster_json FROM vacancy_clusters WHERE id = ?').get(id) as {
      cluster_json: string;
    }
  ).cluster_json;

describe('cluster split step within a write budget (B752)', () => {
  it('a large cluster in parts ends exactly where one unbounded step ends', () => {
    const whole = seed();
    runToEnd(whole, { maxPieces: 1_000 });
    const parts = seed();
    const steps = runToEnd(parts, { maxPieces: 2 });

    expect(endState(parts)).toEqual(endState(whole));
    expect(steps.every((step) => step.pieces <= 2)).toBe(true);
    expect(steps.every((step) => Number.isInteger(step.writeMs))).toBe(true);
    expect(steps.length).toBeGreaterThan(3);
  });

  it('between parts the founder keeps every source and the written pieces are whole', () => {
    const db = seed();
    const before = jsonOf(db, bigId);

    const first = splitClustersStep(db, { now: 1_000, maxPieces: 2 });

    expect(first).toMatchObject({ split: 0, pieces: 2, completed: false });
    expect(jsonOf(db, bigId)).toBe(before);
    for (const id of first.newPieceIds) {
      expect(
        db.prepare('SELECT count(*) AS n FROM vacancy_cluster_keys WHERE cluster_id = ?').get(id),
      ).not.toEqual({ n: 0 });
    }
    expect(db.prepare('SELECT cluster_id FROM cluster_split_progress').all()).toEqual([
      { cluster_id: bigId },
    ]);
  });

  it('reverting the step that started a large cluster restores it from any part', () => {
    const db = seed();
    const before = endState(db);
    const first = splitClustersStep(db, { now: 1_000, maxPieces: 2 });
    splitClustersStep(db, { now: 1_000, maxPieces: 2 });

    revertClusterSplitStep(db, first.stepId!);

    // Счётчики состояния копятся и после отката; сверяются кластеры, ключи, каталог.
    expect(endState(db).slice(0, 4)).toEqual(before.slice(0, 4));
    expect(db.prepare('SELECT count(*) AS n FROM cluster_split_progress').get()).toEqual({ n: 0 });
    runToEnd(db, { maxPieces: 2 });
    const whole = seed();
    runToEnd(whole, { maxPieces: 1_000 });
    expect(endState(db).slice(0, 4)).toEqual(endState(whole).slice(0, 4));
  });

  it('a founder changed between parts is planned again and no stale piece is left', () => {
    const db = seed();
    splitClustersStep(db, { now: 1_000, maxPieces: 2 });
    // Обход тем временем дописал основателю ещё одну площадку с тем же id.
    const extra = vacancy('src-g', '1', COMPANIES[6]!);
    const store = stores[0]!;
    store.replaceSourceSlice('src-g', [extra]);
    const founder = JSON.parse(jsonOf(db, bigId));
    mergeVacancyIntoCluster(founder, extra);
    db.prepare('UPDATE vacancy_clusters SET cluster_json = ? WHERE id = ?').run(
      JSON.stringify(founder),
      bigId,
    );

    runToEnd(db, { maxPieces: 2 });

    const ids = db.prepare("SELECT id FROM vacancy_clusters WHERE id LIKE 'cluster-src-%:1'").all();
    expect(ids).toHaveLength(7);
    const journal = db
      .prepare('SELECT new_piece_ids_json FROM cluster_split_journal WHERE old_cluster_id = ?')
      .get(bigId) as { new_piece_ids_json: string };
    expect(JSON.parse(journal.new_piece_ids_json)).toContain('cluster-src-g:1');
  });

  it('small clusters stop at the piece budget and the next step takes the rest', () => {
    const db = seed();
    runToEnd(db, { maxPieces: 1_000 });
    const fresh = seed();
    // Большой кластер целиком в бюджет 6 кусков, малые (по 2 куска) — уже в следующие шаги.
    const steps = runToEnd(fresh, { maxPieces: 6 });

    expect(steps[0]).toMatchObject({ split: 1, pieces: 5 });
    expect(steps.reduce((sum, step) => sum + step.split, 0)).toBe(3);
    expect(endState(fresh)).toEqual(endState(db));
  });

  it('a zero time budget still moves one cluster per step', () => {
    const db = seed();
    const steps = runToEnd(db, { maxPieces: 1_000, budgetMs: 0 });
    expect(steps.every((step) => step.split <= 1)).toBe(true);
    const whole = seed();
    runToEnd(whole, { maxPieces: 1_000 });
    expect(endState(db)).toEqual(endState(whole));
  });

  it('time spent inside one cluster cuts it into parts too', () => {
    const db = seed();
    const first = splitClustersStep(db, { now: 1_000, maxPieces: 1_000, budgetMs: 0 });
    expect(first).toMatchObject({ split: 0, pieces: 1 });
  });

  it('planning stops after its time, one cluster per step at least', () => {
    const db = seed();
    const steps = runToEnd(db, { maxPieces: 1_000, planMs: 0 });
    expect(steps.every((step) => step.scanned === 1)).toBe(true);
  });

  it('pages of a write are read before the write lock is taken', () => {
    const db = seed();
    const log: string[] = [];
    const prepare = db.prepare.bind(db);
    const exec = db.exec.bind(db);
    const spied = new Proxy(db, {
      get: (target, name) => {
        if (name === 'exec') return (sql: string) => (log.push(sql), exec(sql));
        if (name === 'prepare') return (sql: string) => (log.push(sql), prepare(sql));
        return Reflect.get(target, name);
      },
    });
    splitClustersStep(spied, { now: 1_000 });
    const lock = log.indexOf('BEGIN IMMEDIATE');
    const keyRead = log.findIndex((sql) => /SELECT 1 FROM vacancy_cluster_keys/u.test(sql));
    expect(keyRead).toBeGreaterThanOrEqual(0);
    expect(keyRead).toBeLessThan(lock);
  });

  it('every part reports the step id that reverts the whole cluster', () => {
    const db = seed();
    const before = endState(db).slice(0, 4);
    const first = splitClustersStep(db, { now: 1_000, maxPieces: 2 });
    const second = splitClustersStep(db, { now: 2_000, maxPieces: 2 });

    expect(second.stepId).toBe(first.stepId);
    revertClusterSplitStep(db, second.stepId!);
    expect(endState(db).slice(0, 4)).toEqual(before);
  });

  it('a candidate referencing the founder between parts: the split is dropped, the founder untouched', () => {
    const db = seed();
    const before = endState(db).slice(0, 3);
    splitClustersStep(db, { now: 1_000, maxPieces: 2 });
    db.exec('CREATE TABLE IF NOT EXISTS applications (id TEXT PRIMARY KEY, cluster_id TEXT)');
    db.prepare("INSERT INTO applications VALUES ('a1', ?)").run(bigId);

    const next = splitClustersStep(db, { now: 2_000, maxPieces: 2 });

    expect(next).toMatchObject({ skippedCandidateRef: 1, split: 0 });
    expect(endState(db).slice(0, 3)).toEqual(before);
    expect(db.prepare('SELECT count(*) AS n FROM cluster_split_progress').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT count(*) AS n FROM cluster_split_journal').get()).toEqual({ n: 0 });
  });

  it('a new piece whose id another cluster holds: the split is dropped, that cluster kept', () => {
    const db = seed();
    const before = endState(db).slice(0, 3);
    splitClustersStep(db, { now: 1_000, maxPieces: 2 });
    // Новая площадка основателя, а id её будущего куска уже занят чужим кластером.
    const extra = vacancy('src-g', '1', COMPANIES[6]!);
    stores[0]!.replaceSourceSlice('src-g', [extra]);
    stores[0]!.saveClusters([createClusterFromVacancy(extra)]);
    const otherId = 'cluster-src-g:1';
    const otherOf = () => [
      db.prepare('SELECT * FROM vacancy_clusters WHERE id = ?').get(otherId),
      db
        .prepare('SELECT * FROM vacancy_cluster_keys WHERE cluster_id = ? ORDER BY kind, key')
        .all(otherId),
    ];
    const other = otherOf();
    const founder = JSON.parse(jsonOf(db, bigId));
    mergeVacancyIntoCluster(founder, extra);
    const changed = JSON.stringify(founder);
    db.prepare('UPDATE vacancy_clusters SET cluster_json = ? WHERE id = ?').run(changed, bigId);

    const next = splitClustersStep(db, { now: 2_000, maxPieces: 2 });

    expect(next).toMatchObject({ skippedIdTaken: 1, split: 0 });
    expect(otherOf()).toEqual(other);
    expect(jsonOf(db, bigId)).toBe(changed);
    const pieces = db
      .prepare("SELECT id FROM vacancy_clusters WHERE id LIKE 'cluster-src-%:1' ORDER BY id")
      .all();
    expect(pieces).toEqual([{ id: bigId }, { id: otherId }]);
    expect(endState(db)[0].length).toBe((before[0] as unknown[]).length + 1);
    expect(db.prepare('SELECT count(*) AS n FROM cluster_split_progress').get()).toEqual({ n: 0 });
  });
});

/** B782: откат частями. Основатель возвращается первым, куски снимаются по бюджету. */
describe('cluster split revert within a write budget (B782)', () => {
  function revertToEnd(db: DatabaseSync, stepId: string, maxPieces: number) {
    const chunks = [];
    for (let at = 1; at < 100; at += 1) {
      const chunk = revertClusterSplitChunk(db, stepId, { maxPieces });
      chunks.push(chunk);
      if (chunk.done) return chunks;
    }
    throw new Error('revert did not finish');
  }

  const bigIds = (db: DatabaseSync) =>
    (
      db
        .prepare("SELECT count(*) AS n FROM vacancy_clusters WHERE id LIKE 'cluster-src-%:1'")
        .get() as { n: number }
    ).n;

  it('a step reverted in parts ends where it started', () => {
    const db = seed();
    const before = endState(db).slice(0, 4);
    const steps = runToEnd(db, { maxPieces: 1_000 });

    const chunks = revertToEnd(db, steps[0]!.stepId!, 2);

    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks.every((chunk) => chunk.founders + chunk.piecesRemoved <= 2)).toBe(true);
    expect(chunks.every((chunk) => Number.isInteger(chunk.writeMs))).toBe(true);
    expect(chunks.reduce((sum, chunk) => sum + chunk.restored, 0)).toBe(3);
    expect(endState(db).slice(0, 4)).toEqual(before);
    expect(db.prepare('SELECT count(*) AS n FROM cluster_split_journal').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT completed FROM cluster_split_state').get()).toEqual({ completed: 0 });
  });

  it('between parts readers see a duplicate, never a gap', () => {
    const db = seed();
    const before = jsonOf(db, bigId);
    const stepId = runToEnd(db, { maxPieces: 1_000 })[0]!.stepId!;

    let duplicateSeen = false;
    for (let at = 1; at < 100; at += 1) {
      const chunk = revertClusterSplitChunk(db, stepId, { maxPieces: 2 });
      const whole = jsonOf(db, bigId) === before;
      // Либо основатель ещё разбит и все шесть кусков на месте, либо он уже целый.
      expect(whole || bigIds(db) === 6).toBe(true);
      if (whole && bigIds(db) > 1) duplicateSeen = true;
      if (chunk.done) break;
    }

    expect(duplicateSeen).toBe(true);
    expect(bigIds(db)).toBe(1);
    expect(db.prepare('SELECT count(*) AS n FROM vacancy_catalog_redirects').get()).toEqual({
      n: 0,
    });
  });

  it('a large split stopped half way reverts in parts and drops its progress', () => {
    const db = seed();
    const before = endState(db).slice(0, 4);
    const first = splitClustersStep(db, { now: 1_000, maxPieces: 2 });
    splitClustersStep(db, { now: 1_000, maxPieces: 2 });

    revertToEnd(db, first.stepId!, 1);

    expect(endState(db).slice(0, 4)).toEqual(before);
    expect(db.prepare('SELECT count(*) AS n FROM cluster_split_progress').get()).toEqual({ n: 0 });
    // Курсор снова перед большим кластером: следующий проход разобьёт его заново.
    runToEnd(db, { maxPieces: 2 });
    const whole = seed();
    runToEnd(whole, { maxPieces: 1_000 });
    expect(endState(db).slice(0, 4)).toEqual(endState(whole).slice(0, 4));
  });

  it('the one-shot revert runs the same parts and counts restored clusters', () => {
    const db = seed();
    const before = endState(db).slice(0, 4);
    const steps = runToEnd(db, { maxPieces: 1_000 });

    expect(revertClusterSplitStep(db, steps[0]!.stepId!, { maxPieces: 1 })).toBe(3);
    expect(endState(db).slice(0, 4)).toEqual(before);
  });

  it('a founder changed by ingest after its restore is not restored again', () => {
    const db = seed();
    const stepId = runToEnd(db, { maxPieces: 1_000 })[0]!.stepId!;
    const revertUntilBigWhole = () => {
      const before = bigIds(db);
      for (let at = 1; at < 100; at += 1) {
        revertClusterSplitChunk(db, stepId, { maxPieces: 2 });
        if (bigIds(db) < before || jsonOf(db, bigId).includes('src-f')) return;
      }
    };
    revertUntilBigWhole();
    expect(bigIds(db)).toBeGreaterThan(1);
    // Обход дописал основателю новую площадку между частями отката.
    const founder = JSON.parse(jsonOf(db, bigId));
    mergeVacancyIntoCluster(founder, vacancy('src-g', '1', COMPANIES[6]!));
    const changed = JSON.stringify(founder);
    db.prepare('UPDATE vacancy_clusters SET cluster_json = ? WHERE id = ?').run(changed, bigId);

    revertToEnd(db, stepId, 2);

    expect(jsonOf(db, bigId)).toBe(changed);
    expect(bigIds(db)).toBe(1);
  });

  it('a page key taken by a piece goes back to the founder', () => {
    const db = seed();
    const page = (id: string) =>
      db.prepare('SELECT entry_key FROM catalog_entries WHERE cluster_id = ?').get(id) as
        { entry_key: string } | undefined;
    const key = page(bigId)!.entry_key;
    const stepId = runToEnd(db, { maxPieces: 1_000 })[0]!.stepId!;
    // Совпадение 32-битного ключа: страница куска получила прежний ключ основателя.
    db.prepare('DELETE FROM catalog_entries WHERE cluster_id = ?').run(bigId);
    db.prepare('UPDATE catalog_entries SET entry_key = ? WHERE cluster_id = ?').run(
      key,
      'cluster-src-f:1',
    );

    revertToEnd(db, stepId, 2);

    expect(page(bigId)).toEqual({ entry_key: key });
  });

  it('a zero time budget still moves one unit per part', () => {
    const db = seed();
    const before = endState(db).slice(0, 4);
    const stepId = runToEnd(db, { maxPieces: 1_000 })[0]!.stepId!;
    const chunks = [];
    for (let at = 1; at < 100; at += 1) {
      const chunk = revertClusterSplitChunk(db, stepId, { maxPieces: 1_000, budgetMs: 0 });
      chunks.push(chunk);
      if (chunk.done) break;
    }
    expect(chunks.every((chunk) => chunk.founders + chunk.piecesRemoved <= 1)).toBe(true);
    expect(endState(db).slice(0, 4)).toEqual(before);
  });

  it('an unknown step is done at once', () => {
    const db = seed();
    expect(revertClusterSplitChunk(db, 'split-none', {})).toMatchObject({
      restored: 0,
      done: true,
    });
  });
});
