import { computeHeavyRead } from '../maintenance/heavyReads/heavyReadJobs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { VACANCY_CATALOG_ENTRIES_TABLE, VACANCY_CLUSTERS_TABLE } from '../data/sqliteSchema';
import { PRIVATE_EMPLOYER } from '../../shared/privateEmployer';
import {
  admitCardRollout,
  chooseCardRolloutCandidates,
  cardRolloutDailyCap,
  CARD_ROLLOUT_DAILY_CAP_DEFAULT,
} from './catalogCardRollout';
import { computeCatalogSitemaps } from './catalogSitemapJob';

const NOW = new Date('2026-11-05T12:00:00.000Z');
const DAY = 86_400_000;
const TEXT = 'Настоящий текст вакансии от работодателя. '.repeat(5);

interface Card {
  id: string;
  sources?: string[];
  salary?: string | null;
  summary?: string;
  poolText?: string | null;
  expired?: boolean;
  company?: string;
  location?: string | null;
  remote?: boolean;
  posted?: number;
  seen?: number;
  noCluster?: boolean;
}

function database(cards: readonly Card[]): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(VACANCY_CATALOG_ENTRIES_TABLE);
  db.exec(VACANCY_CLUSTERS_TABLE);
  db.exec('CREATE TABLE vacancy_pool_index (id TEXT PRIMARY KEY, expired INTEGER NOT NULL)');
  db.exec('CREATE TABLE vacancy_pool (id TEXT PRIMARY KEY, payload TEXT NOT NULL)');
  for (const card of cards) {
    const posted = NOW.getTime() - (card.posted ?? 1) * DAY;
    const seen = NOW.getTime() - (card.seen ?? 0) * DAY;
    db.prepare(
      `INSERT INTO catalog_entries (
         cluster_id, entry_key, path, title, company, location, is_remote, salary_label, summary,
         skills_json, source_url, source_name, published_at, last_seen_at, source_count, status,
         place_slug, place_label, role_slug, role_label, published_ms, last_seen_ms
       ) VALUES (?, ?, ?, 'Project Manager', ?, ?, ?, ?, ?, '[]', 'https://x', NULL, ?, ?, 1,
         'active', 'moscow', 'Moscow', 'project-manager', 'Project Manager', ?, ?)`,
    ).run(
      `cluster-${card.id}`,
      card.id,
      `/vacancies/job/project-manager-${card.id}`,
      card.company ?? 'Acme',
      card.location === undefined ? 'Москва' : card.location,
      card.remote ? 1 : 0,
      card.salary ?? null,
      card.summary ?? '',
      new Date(posted).toISOString(),
      new Date(seen).toISOString(),
      posted,
      seen,
    );
    if (!card.noCluster) {
      db.prepare(
        `INSERT INTO vacancy_clusters (id, fingerprint, title, company, cluster_json, items_count, updated_at)
         VALUES (?, ?, 't', 'c', ?, 1, 0)`,
      ).run(
        `cluster-${card.id}`,
        card.id,
        JSON.stringify({
          sources: (card.sources ?? ['src-hh-search']).map((sourceId) => ({ sourceId })),
        }),
      );
    }
    if (card.poolText !== null) {
      db.prepare('INSERT INTO vacancy_pool (id, payload) VALUES (?, ?)').run(
        card.id,
        JSON.stringify({ fullDescription: card.poolText ?? TEXT }),
      );
      db.prepare('INSERT INTO vacancy_pool_index (id, expired) VALUES (?, ?)').run(
        card.id,
        card.expired ? 1 : 0,
      );
    }
  }
  return db;
}

function admitted(db: DatabaseSync): string[] {
  return (
    db.prepare('SELECT cluster_id FROM catalog_card_rollout ORDER BY cluster_id').all() as Array<{
      cluster_id: string;
    }>
  ).map((row) => row.cluster_id.replace('cluster-', ''));
}

describe('admitCardRollout', () => {
  it('admits a card with no salary whose text lies only in the pool', async () => {
    const db = database([{ id: 'hh' }]);
    expect((await admitCardRollout(db, NOW, 10)).admitted).toBe(1);
    expect(admitted(db)).toEqual(['hh']);
  });

  it('never admits a cluster with Himalayas in it, or whose sources are unknown', async () => {
    const db = database([
      { id: 'hima', sources: ['src-himalayas-api'] },
      { id: 'pair', sources: ['src-indeed', 'src-himalayas-api'] },
      { id: 'gone', noCluster: true },
      { id: 'free', sources: ['src-linkedin-guest'] },
    ]);
    await admitCardRollout(db, NOW, 10);
    expect(admitted(db)).toEqual(['free']);
  });

  it('keeps the minimum rules: text, employer, location, seen within the window', async () => {
    const db = database([
      { id: 'short', poolText: 'Коротко' },
      { id: 'notext', poolText: null },
      { id: 'expired', expired: true },
      { id: 'noco', company: '  ' },
      { id: 'private', company: PRIVATE_EMPLOYER },
      { id: 'noplace', location: null },
      { id: 'remoteanywhere', location: null, remote: true },
      { id: 'stale', seen: 15 },
      { id: 'ok' },
    ]);
    await admitCardRollout(db, NOW, 100);
    expect(admitted(db)).toEqual(['ok']);
  });

  it('leaves a card the salary rule already indexes outside the quota', async () => {
    const db = database([{ id: 'old', salary: '100 000 ₽', summary: TEXT }, { id: 'new' }]);
    expect((await admitCardRollout(db, NOW, 1)).admitted).toBe(1);
    expect(admitted(db)).toEqual(['new']);
  });

  it('takes the freshest day first and the longest text within a day', async () => {
    const db = database([
      { id: 'older', posted: 3, poolText: TEXT.repeat(5) },
      { id: 'short', posted: 1, poolText: TEXT },
      { id: 'long', posted: 1, poolText: TEXT.repeat(3) },
    ]);
    await admitCardRollout(db, NOW, 8);
    expect(admitted(db)).toEqual(['long', 'short']);
  });

  it('spends the cap in portions six hours apart and never above it in a rolling day', async () => {
    const db = database(['a', 'b', 'c', 'd', 'e', 'f'].map((id) => ({ id })));
    const at = (hours: number) => new Date(NOW.getTime() + hours * 3_600_000);
    expect((await admitCardRollout(db, NOW, 3)).admitted).toBe(1);
    expect((await admitCardRollout(db, at(1), 3)).admitted).toBe(0);
    expect((await admitCardRollout(db, at(6), 3)).admitted).toBe(1);
    expect((await admitCardRollout(db, at(12), 3)).admitted).toBe(1);
    expect((await admitCardRollout(db, at(18), 3)).admitted).toBe(0);
    expect((await admitCardRollout(db, at(24.5), 3)).admitted).toBe(1);
  });

  it('a card posted today goes ahead of the older queue', async () => {
    const db = database([
      { id: 'old1', posted: 5 },
      { id: 'old2', posted: 5 },
      { id: 'today', posted: 0 },
    ]);
    await admitCardRollout(db, NOW, 4);
    expect(admitted(db)).toEqual(['today']);
  });

  it('a cap of zero stops new cards and keeps those already in', async () => {
    const db = database([{ id: 'a' }, { id: 'b', posted: 2 }]);
    await admitCardRollout(db, NOW, 1);
    expect((await admitCardRollout(db, new Date(NOW.getTime() + 2 * DAY), 0)).admitted).toBe(0);
    expect(admitted(db)).toEqual(['a']);
  });

  it('drops an admitted card whose text went away', async () => {
    const db = database([{ id: 'a' }]);
    await admitCardRollout(db, NOW, 1);
    db.prepare('UPDATE vacancy_pool_index SET expired = 1').run();
    expect((await admitCardRollout(db, NOW, 1)).dropped).toBe(1);
    expect(admitted(db)).toEqual([]);
  });

  // B761 23.11: on prod the drop was one DELETE whose subquery scanned the whole
  // table under the write lock: 8.7 s held, longer than busy_timeout (5 s).
  it('drops in windows by id: each DELETE names at most 500 cards, the scan runs outside it', async () => {
    const cards = Array.from({ length: 1_200 }, (_, index) => ({
      id: `c${String(index).padStart(4, '0')}`,
    }));
    const db = database([...cards, { id: 'keep' }]);
    await admitCardRollout(db, NOW, 8_000);
    expect(admitted(db)).toHaveLength(1_201);
    db.prepare("UPDATE vacancy_pool_index SET expired = 1 WHERE id <> 'keep'").run();
    const deletes: number[] = [];
    const prepare = db.prepare.bind(db);
    db.prepare = ((sql: string) => {
      const statement = prepare(sql);
      if (!/^\s*DELETE FROM catalog_card_rollout/u.test(sql)) return statement;
      const run = statement.run.bind(statement);
      statement.run = ((...params: Parameters<typeof run>) => {
        deletes.push(params.length);
        return run(...params);
      }) as typeof statement.run;
      return statement;
    }) as typeof db.prepare;

    expect((await admitCardRollout(db, NOW, 8_000)).dropped).toBe(1_200);
    expect(admitted(db)).toEqual(['keep']);
    expect(deletes.length).toBeGreaterThanOrEqual(3);
    expect(Math.max(...deletes)).toBeLessThanOrEqual(501);
  });
});

describe('the rollout keeps the loop free (B761)', () => {
  // B761 23.11: on prod the candidate scan held the maintenance loop 135–230 s four times a
  // day, and the drop sweep 5–8 s on every sitemap run. The scan now runs in the heavy-read
  // thread and returns only the chosen cards; the drop sweep yields between windows.
  it('asks the chooser for the portion quota and admits exactly the rows it returns', async () => {
    const db = database([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    const quotas: number[] = [];
    const report = await admitCardRollout(db, NOW, 8, {
      choose: async (quota) => {
        quotas.push(quota);
        return chooseCardRolloutCandidates(db, NOW, 1);
      },
    });
    expect(quotas).toEqual([2]);
    expect(report.admitted).toBe(1);
    expect(admitted(db)).toHaveLength(1);
  });

  it('the heavy-read job chooses the same cards as the in-process scan', async () => {
    const db = database([{ id: 'a' }, { id: 'b', posted: 2 }, { id: 'c' }]);
    // The writer creates the rollout tables before it hands the scan to the thread.
    await admitCardRollout(db, NOW, 0);
    const inThread = computeHeavyRead(db, 'cardRolloutCandidates', {
      nowMs: NOW.getTime(),
      quota: 2,
    });
    expect(inThread).toEqual(chooseCardRolloutCandidates(db, NOW, 2));
    expect(inThread).toHaveLength(2);
  });

  it('the drop sweep pauses between windows', async () => {
    const cards = Array.from({ length: 1_200 }, (_, index) => ({
      id: `c${String(index).padStart(4, '0')}`,
    }));
    const db = database(cards);
    await admitCardRollout(db, NOW, 8_000);
    db.prepare('UPDATE vacancy_pool_index SET expired = 1').run();
    let pauses = 0;
    const report = await admitCardRollout(db, NOW, 8_000, {
      pause: async () => void (pauses += 1),
    });
    expect(report.dropped).toBe(1_200);
    expect(pauses).toBeGreaterThanOrEqual(2);
  });
});

describe('the jobs sitemap with the rollout', () => {
  it('lists admitted cards with no salary, and no others', async () => {
    const db = database([{ id: 'in' }, { id: 'waiting', posted: 2 }]);
    await admitCardRollout(db, NOW, 1);
    const jobs = computeCatalogSitemaps(db, NOW).find((file) => file.name === 'jobs-1.xml')!;
    expect(jobs.xml).toContain('project-manager-in');
    expect(jobs.xml).not.toContain('project-manager-waiting');
  });

  it('drops an admitted card once it is out of the freshness window', async () => {
    const db = database([{ id: 'a' }]);
    await admitCardRollout(db, NOW, 1);
    const files = computeCatalogSitemaps(db, new Date(NOW.getTime() + 15 * DAY));
    expect(files.some((file) => file.name.startsWith('jobs-'))).toBe(false);
  });
});

describe('cardRolloutDailyCap', () => {
  it('reads a whole number from the setting, else the default', () => {
    expect(cardRolloutDailyCap(undefined)).toBe(CARD_ROLLOUT_DAILY_CAP_DEFAULT);
    expect(cardRolloutDailyCap('2500')).toBe(2500);
    expect(cardRolloutDailyCap('0')).toBe(0);
    for (const bad of ['', 'много', '-1', '1.5']) {
      expect(cardRolloutDailyCap(bad)).toBe(CARD_ROLLOUT_DAILY_CAP_DEFAULT);
    }
  });
});
