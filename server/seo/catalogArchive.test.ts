import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import {
  archivePageDecision,
  closeCatalogArchiveReaders,
  readCatalogArchiveCard,
  recordArchiveImpressions,
  snapshotSitemapCards,
  type CatalogArchiveCard,
} from './catalogArchive';

const CATALOG_ENTRIES_SQL = `CREATE TABLE catalog_entries (
  cluster_id TEXT PRIMARY KEY, entry_key TEXT NOT NULL UNIQUE, path TEXT NOT NULL,
  title TEXT NOT NULL, company TEXT NOT NULL, location TEXT, is_remote INTEGER NOT NULL,
  salary_label TEXT, summary TEXT NOT NULL, skills_json TEXT NOT NULL, source_url TEXT NOT NULL,
  source_name TEXT, published_at TEXT NOT NULL, last_seen_at TEXT NOT NULL,
  source_count INTEGER NOT NULL, status TEXT NOT NULL, place_slug TEXT, place_label TEXT,
  role_slug TEXT, role_label TEXT, published_ms INTEGER NOT NULL, last_seen_ms INTEGER NOT NULL
) STRICT`;
const DAY = 86_400_000;
const NOW = new Date('2026-11-11T12:00:00Z');
const dirs: string[] = [];

afterEach(() => {
  closeCatalogArchiveReaders();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function database(): { db: DatabaseSync; path: string } {
  const dir = mkdtempSync(join(tmpdir(), 'archive-'));
  dirs.push(dir);
  const path = join(dir, 'db.sqlite');
  const db = new DatabaseSync(path);
  db.exec(CATALOG_ENTRIES_SQL);
  return { db, path };
}

function insertEntry(db: DatabaseSync, key: string, overrides: Record<string, unknown> = {}) {
  const row = {
    cluster_id: `cluster-${key}`,
    entry_key: key,
    path: `/vacancies/job/frontend-at-acme-${key}`,
    title: 'Frontend Developer',
    company: 'Acme',
    location: 'Berlin',
    is_remote: 0,
    salary_label: '5 000 €',
    summary: 'Делаем интерфейсы на React для банков.',
    skills_json: '["React"]',
    source_url: 'https://boards.example.com/1',
    source_name: 'src-remoteok',
    published_at: '2026-11-01T00:00:00.000Z',
    last_seen_at: '2026-11-10T00:00:00.000Z',
    source_count: 1,
    status: 'active',
    place_slug: 'berlin',
    place_label: 'Берлин',
    role_slug: 'frontend-developer',
    role_label: 'Frontend-разработчик',
    published_ms: 0,
    last_seen_ms: 0,
    ...overrides,
  };
  const names = Object.keys(row);
  db.prepare(
    `INSERT INTO catalog_entries (${names.join(',')}) VALUES (${names.map(() => '?').join(',')})`,
  ).run(...(Object.values(row) as Array<string | number>));
  return row;
}

describe('catalog archive snapshot', () => {
  it('keeps the text and path of a sitemap card after the catalog row loses them', () => {
    const { db, path } = database();
    const row = insertEntry(db, 'abc');
    snapshotSitemapCards(db, [row.path], NOW);
    // Archiving clears the summary; pruning deletes the row.
    db.prepare(
      "UPDATE catalog_entries SET status = 'archived', summary = '' WHERE entry_key = 'abc'",
    ).run();
    recordArchiveImpressions(db, [row.path], new Date(NOW.getTime() + DAY));
    db.prepare("DELETE FROM catalog_entries WHERE entry_key = 'abc'").run();

    const card = readCatalogArchiveCard(path, 'abc');
    expect(card).toMatchObject({
      path: row.path,
      title: 'Frontend Developer',
      summary: 'Делаем интерфейсы на React для банков.',
      placeSlug: 'berlin',
      roleSlug: 'frontend-developer',
      lastListedAt: NOW.toISOString(),
      lastImpressionAt: new Date(NOW.getTime() + DAY).toISOString(),
    });
  });

  it('records impressions by card path, snapshotting a card that never was in the sitemap', () => {
    const { db, path } = database();
    const row = insertEntry(db, 'def');
    recordArchiveImpressions(db, [row.path, '/vacancies/job/unknown-zzz'], NOW);
    const card = readCatalogArchiveCard(path, 'def');
    expect(card?.lastImpressionAt).toBe(NOW.toISOString());
    expect(card?.lastListedAt).toBeUndefined();
    expect(readCatalogArchiveCard(path, 'zzz')).toBeUndefined();
  });

  it('reads nothing before the maintenance process created the table', () => {
    const dir = mkdtempSync(join(tmpdir(), 'archive-'));
    dirs.push(dir);
    const path = join(dir, 'empty.sqlite');
    new DatabaseSync(path).close();
    expect(readCatalogArchiveCard(path, 'abc')).toBeUndefined();
  });
});

describe('catalog archive pruning', () => {
  it('drops copies that can only answer 410', () => {
    const { db, path } = database();
    const row = insertEntry(db, 'old', { last_seen_at: '2026-04-01T00:00:00.000Z' });
    snapshotSitemapCards(db, [row.path], new Date('2026-04-02T00:00:00Z'));
    expect(readCatalogArchiveCard(path, 'old')).toBeDefined();
    closeCatalogArchiveReaders();
    snapshotSitemapCards(db, [], NOW);
    expect(readCatalogArchiveCard(path, 'old')).toBeUndefined();
  });
});

describe('archivePageDecision', () => {
  const card: CatalogArchiveCard = {
    entryKey: 'abc',
    path: '/vacancies/job/frontend-at-acme-abc',
    title: 'Frontend Developer',
    company: 'Acme',
    isRemote: false,
    summary: 'Текст',
    publishedAt: '2026-10-01T00:00:00.000Z',
    lastSeenAt: '2026-11-01T00:00:00.000Z',
  };
  const days = (n: number) => new Date(NOW.getTime() - n * DAY).toISOString();

  it('archives a card that was in the sitemap or had impressions', () => {
    expect(archivePageDecision({ ...card, lastListedAt: days(10) }, NOW)).toBe('archive');
    expect(archivePageDecision({ ...card, lastImpressionAt: days(10) }, NOW)).toBe('archive');
  });

  it('answers gone without sitemap history or impressions', () => {
    expect(archivePageDecision(card, NOW)).toBe('gone');
    expect(archivePageDecision(undefined, NOW)).toBe('gone');
  });

  it('answers gone after 180 days closed without impressions for 90 days', () => {
    const old = { ...card, lastSeenAt: days(181), lastListedAt: days(181) };
    expect(archivePageDecision(old, NOW)).toBe('gone');
    expect(archivePageDecision({ ...old, lastImpressionAt: days(91) }, NOW)).toBe('gone');
    expect(archivePageDecision({ ...old, lastImpressionAt: days(30) }, NOW)).toBe('archive');
    expect(archivePageDecision({ ...old, lastSeenAt: days(170) }, NOW)).toBe('archive');
  });
});
