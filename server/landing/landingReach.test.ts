import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { landingFeedMeta, readLandingReach } from './landingReach';

const row = (overrides: Partial<Parameters<typeof landingFeedMeta>[0]>) => ({
  company: 'vidIQ',
  location: null,
  place_label: null,
  is_remote: 1,
  ...overrides,
});

describe('landingFeedMeta (B648: «Формат · География · Компания»)', () => {
  it('names the format, the area and the employer, never the source or the date', () => {
    expect(landingFeedMeta(row({ location: 'Worldwide' }))).toBe('Удалённо · Везде · vidIQ');
    expect(landingFeedMeta(row({ company: 'GitLab', location: 'United States' }))).toBe(
      'Удалённо · США · GitLab',
    );
    expect(
      landingFeedMeta(
        row({ company: 'Сбер', is_remote: 0, place_label: 'Москва', location: 'Москва, Россия' }),
      ),
    ).toBe('Офис · Москва · Сбер');
  });

  it('never invents an area and drops an unnamed employer', () => {
    expect(landingFeedMeta(row({ location: 'Remote' }))).toBe('Удалённо · vidIQ');
    expect(landingFeedMeta(row({ location: 'Remote - Florida' }))).toBe('Удалённо · vidIQ');
    expect(landingFeedMeta(row({ company: '', location: 'United States' }))).toBe('Удалённо · США');
    expect(landingFeedMeta(row({ is_remote: 0, location: 'Chicago, IL' }))).toBe(
      'Офис · Chicago · vidIQ',
    );
  });
});

describe('readLandingReach', () => {
  it('counts named employers, career sites and the catalog cards of the last day', () => {
    const database = new DatabaseSync(':memory:');
    database.exec(`CREATE TABLE catalog_entries (company TEXT, status TEXT, published_ms INTEGER);
      CREATE TABLE vacancy_source_state (source_id TEXT, items_active_total INTEGER)`);
    const now = new Date('2026-11-12T12:00:00Z');
    const insert = database.prepare('INSERT INTO catalog_entries VALUES (?, ?, ?)');
    insert.run('GitLab', 'active', now.getTime() - 3_600_000);
    insert.run('GitLab', 'active', now.getTime() - 2 * 86_400_000);
    insert.run('Сбер', 'active', now.getTime() - 60_000);
    insert.run('Old', 'archived', now.getTime() - 60_000);
    const source = database.prepare('INSERT INTO vacancy_source_state VALUES (?, ?)');
    source.run('ats-greenhouse-gitlab', 40);
    source.run('src-company-site-sber', 3);
    source.run('src-hh-search', 500_000);
    source.run('src-himalayas', 60_000);
    source.run('ats-lever-gone', 0);
    expect(readLandingReach(database, now)).toEqual({
      companies: 2,
      careerSites: 2,
      newToday: 2,
    });
  });

  it('is absent when the catalog is not projected yet', () => {
    expect(readLandingReach(new DatabaseSync(':memory:'), new Date())).toBeUndefined();
  });
});

describe('readLandingFeed (B648)', () => {
  it('shows only cards with a named employer', async () => {
    const { readLandingFeed } = await import('./landingStatsJob');
    const database = new DatabaseSync(':memory:');
    database.exec(`CREATE TABLE catalog_entries (title TEXT, path TEXT, salary_label TEXT,
      place_label TEXT, location TEXT, is_remote INTEGER, company TEXT, status TEXT, published_ms INTEGER)`);
    const insert = database.prepare(
      "INSERT INTO catalog_entries VALUES (?, ?, '$100 тыс.', NULL, 'United States', 1, ?, 'active', ?)",
    );
    insert.run('Product Manager', '/vacancies/job/pm', '', 2);
    insert.run('Data Engineer', '/vacancies/job/de', 'GitLab', 1);
    expect(readLandingFeed(database).map((row) => row.meta)).toEqual(['Удалённо · США · GitLab']);
  });
});
