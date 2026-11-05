import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { VACANCY_CATALOG_ENTRIES_TABLE, VACANCY_CLUSTERS_TABLE } from '../data/sqliteSchema';
import { PRIVATE_EMPLOYER } from '../../shared/privateEmployer';
import {
  admitCardRollout,
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
  it('admits a card with no salary whose text lies only in the pool', () => {
    const db = database([{ id: 'hh' }]);
    expect(admitCardRollout(db, NOW, 10).admitted).toBe(1);
    expect(admitted(db)).toEqual(['hh']);
  });

  it('never admits a cluster with Himalayas in it, or whose sources are unknown', () => {
    const db = database([
      { id: 'hima', sources: ['src-himalayas-api'] },
      { id: 'pair', sources: ['src-indeed', 'src-himalayas-api'] },
      { id: 'gone', noCluster: true },
      { id: 'free', sources: ['src-linkedin-guest'] },
    ]);
    admitCardRollout(db, NOW, 10);
    expect(admitted(db)).toEqual(['free']);
  });

  it('keeps the minimum rules: text, employer, location, seen within the window', () => {
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
    admitCardRollout(db, NOW, 100);
    expect(admitted(db)).toEqual(['ok']);
  });

  it('leaves a card the salary rule already indexes outside the quota', () => {
    const db = database([{ id: 'old', salary: '100 000 ₽', summary: TEXT }, { id: 'new' }]);
    expect(admitCardRollout(db, NOW, 1).admitted).toBe(1);
    expect(admitted(db)).toEqual(['new']);
  });

  it('takes the freshest day first and the longest text within a day', () => {
    const db = database([
      { id: 'older', posted: 3, poolText: TEXT.repeat(5) },
      { id: 'short', posted: 1, poolText: TEXT },
      { id: 'long', posted: 1, poolText: TEXT.repeat(3) },
    ]);
    admitCardRollout(db, NOW, 8);
    expect(admitted(db)).toEqual(['long', 'short']);
  });

  it('spends the cap in portions six hours apart and never above it in a rolling day', () => {
    const db = database(['a', 'b', 'c', 'd', 'e', 'f'].map((id) => ({ id })));
    const at = (hours: number) => new Date(NOW.getTime() + hours * 3_600_000);
    expect(admitCardRollout(db, NOW, 3).admitted).toBe(1);
    expect(admitCardRollout(db, at(1), 3).admitted).toBe(0);
    expect(admitCardRollout(db, at(6), 3).admitted).toBe(1);
    expect(admitCardRollout(db, at(12), 3).admitted).toBe(1);
    expect(admitCardRollout(db, at(18), 3).admitted).toBe(0);
    expect(admitCardRollout(db, at(24.5), 3).admitted).toBe(1);
  });

  it('a card posted today goes ahead of the older queue', () => {
    const db = database([
      { id: 'old1', posted: 5 },
      { id: 'old2', posted: 5 },
      { id: 'today', posted: 0 },
    ]);
    admitCardRollout(db, NOW, 4);
    expect(admitted(db)).toEqual(['today']);
  });

  it('a cap of zero stops new cards and keeps those already in', () => {
    const db = database([{ id: 'a' }, { id: 'b', posted: 2 }]);
    admitCardRollout(db, NOW, 1);
    expect(admitCardRollout(db, new Date(NOW.getTime() + 2 * DAY), 0).admitted).toBe(0);
    expect(admitted(db)).toEqual(['a']);
  });

  it('drops an admitted card whose text went away', () => {
    const db = database([{ id: 'a' }]);
    admitCardRollout(db, NOW, 1);
    db.prepare('UPDATE vacancy_pool_index SET expired = 1').run();
    expect(admitCardRollout(db, NOW, 1).dropped).toBe(1);
    expect(admitted(db)).toEqual([]);
  });
});

describe('the jobs sitemap with the rollout', () => {
  it('lists admitted cards with no salary, and no others', () => {
    const db = database([{ id: 'in' }, { id: 'waiting', posted: 2 }]);
    admitCardRollout(db, NOW, 1);
    const jobs = computeCatalogSitemaps(db, NOW).find((file) => file.name === 'jobs-1.xml')!;
    expect(jobs.xml).toContain('project-manager-in');
    expect(jobs.xml).not.toContain('project-manager-waiting');
  });

  it('drops an admitted card once it is out of the freshness window', () => {
    const db = database([{ id: 'a' }]);
    admitCardRollout(db, NOW, 1);
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
