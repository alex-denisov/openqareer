import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runHeavyReadJob } from '../maintenance/heavyReads/heavyReadJobs';
import { VACANCY_CATALOG_ENTRIES_TABLE } from '../data/sqliteSchema';
import { SqliteVacancyPoolStore } from '../vacancies/sqliteVacancyPoolStore';
import { recordListingHistory } from './catalogListingHistory';
import { readCatalogSitemaps, writeCatalogSitemaps } from './catalogSitemapJob';
import { sitemapFailure } from './catalogSitemapSchedule';

const NOW = new Date('2026-11-24T12:00:00.000Z');
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function catalogFile(cards: number): DatabaseSync {
  const dir = mkdtempSync(join(tmpdir(), 'oq-sitemaps-'));
  dirs.push(dir);
  const path = join(dir, 'db.sqlite');
  new SqliteVacancyPoolStore({ databasePath: path });
  const database = new DatabaseSync(path);
  database.exec('PRAGMA journal_mode = WAL;');
  database.exec(VACANCY_CATALOG_ENTRIES_TABLE);
  const insert = database.prepare(
    `INSERT INTO catalog_entries (
       cluster_id, entry_key, path, title, company, location, is_remote, salary_label, summary,
       skills_json, source_url, source_name, published_at, last_seen_at, source_count, status,
       place_slug, place_label, role_slug, role_label, published_ms, last_seen_ms
     ) VALUES (?, ?, ?, 'Frontend Developer', 'Acme', NULL, 0, NULL, ?, '[]', 'https://x', NULL,
       ?, ?, 1, 'active', 'berlin', 'Berlin', 'frontend-developer', 'Frontend Developer', ?, ?)`,
  );
  for (let i = 0; i < cards; i += 1) {
    const key = `a${i}`;
    const path = `/vacancies/job/frontend-developer-at-acme-${key}`;
    const at = NOW.toISOString();
    insert.run(`c-${i}`, key, path, 'Build the product. '.repeat(10), at, at, +NOW, +NOW);
  }
  return database;
}

describe('прод 24.11: карты сайта собирает поток со своим соединением-писателем', () => {
  // С 13.11 (#659) расчёт шёл на соединении readOnly и падал на записи истории списков.
  it('файлы, история списков и архив записаны; наружу — сводка и адреса строками', () => {
    const database = catalogFile(60);
    const summary = runHeavyReadJob(database.location() ?? '', 'sitemapsWrite', {
      nowMs: +NOW,
    });
    expect(readCatalogSitemaps(database)?.map((file) => file.name)).toContain('jobs-1.xml');
    const count = (table: string) =>
      (database.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;
    expect(count('catalog_listing_history')).toBeGreaterThan(0);
    expect(count('catalog_sitemaps_build')).toBe(1);
    expect(summary.archive).toMatchObject({ copied: 60 });
    expect(count('catalog_archive_cards')).toBe(60);
    expect(summary.files.some((file) => 'xml' in file || 'urls' in file)).toBe(false);
    expect(summary.urlsJson.flatMap((json) => JSON.parse(json) as unknown[])).toHaveLength(
      summary.files.reduce((sum, file) => sum + file.urlCount, 0),
    );
    database.close();
  });

  it('второй писатель проходит между порциями; лишний файл уходит, подпись — последней', () => {
    const database = catalogFile(0);
    const file = (name: string) => ({ name, xml: `<${name}/>`, urlCount: 1 });
    writeCatalogSitemaps(database, [file('a'), file('b')], NOW);
    const other = new DatabaseSync(database.location() ?? '');
    const signature = () =>
      (other.prepare('SELECT signature FROM catalog_sitemaps_build').get() as { signature: string })
        .signature;
    const before = signature();
    const pause = vi.fn(() => {
      expect(signature()).toBe(before);
      other.exec('CREATE TABLE IF NOT EXISTS probe (id INTEGER)');
      other.exec('INSERT INTO probe VALUES (1)');
    });
    writeCatalogSitemaps(database, [file('b'), file('c')], new Date(+NOW + 1), pause);
    expect(pause).toHaveBeenCalledTimes(2);
    expect(signature()).not.toBe(before);
    expect(readCatalogSitemaps(database)?.map((row) => row.name)).toEqual(['b', 'c']);
    other.close();
    database.close();
  });

  it('история списков пишется порциями', () => {
    const database = new DatabaseSync(':memory:');
    const pause = vi.fn();
    const counts = Array.from({ length: 2_500 }, (_, i) => ({ place: `p${i}`, count: 50 }));
    recordListingHistory(database, counts, NOW, pause);
    expect(pause).toHaveBeenCalledTimes(2);
  });
});

describe('журнал называет причину сбоя', () => {
  it('имя, сообщение и код; токены вырезаны', () => {
    const error = Object.assign(
      new Error(`attempt to write a readonly database ${'x'.repeat(40)}`),
      { code: 'ERR_SQLITE_ERROR' },
    );
    expect(sitemapFailure(error)).toEqual({
      errorName: 'Error',
      errorCode: 'ERR_SQLITE_ERROR',
      reason: 'attempt to write a readonly database [redacted]',
    });
  });
});
