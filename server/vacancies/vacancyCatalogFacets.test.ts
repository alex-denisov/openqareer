import { describe, expect, it } from 'vitest';
import { catalogListings, listingEntries, MIN_LISTING_SIZE } from './vacancyCatalogFacets';
import type { CatalogEntry } from './vacancyCatalogPage';

function entry(overrides: Partial<CatalogEntry> = {}): CatalogEntry {
  return {
    key: 'k1',
    path: '/vacancies/job/frontend-developer-at-acme-k1',
    title: 'Frontend Developer',
    company: 'Acme',
    location: 'Berlin',
    isRemote: false,
    summary: 'Описание.',
    skills: [],
    sourceUrl: 'https://example.com/1',
    publishedAt: '2026-09-01T00:00:00.000Z',
    lastSeenAt: '2026-09-06T00:00:00.000Z',
    sourceCount: 1,
    ...overrides,
  };
}

function many(count: number, overrides: Partial<CatalogEntry> = {}): CatalogEntry[] {
  return Array.from({ length: count }, (_, index) =>
    entry({ key: `k${index}`, path: `/vacancies/job/x-${index}`, ...overrides }),
  );
}

describe('списки каталога по месту и роли (B209, срез 2b)', () => {
  it('не публикует список, в котором меньше порога вакансий', () => {
    const thin = catalogListings(many(MIN_LISTING_SIZE - 1));
    expect(thin).toHaveLength(0);

    const enough = catalogListings(many(MIN_LISTING_SIZE));
    expect(enough.length).toBeGreaterThan(0);
  });

  it('строит список по месту и список по месту с ролью', () => {
    const listings = catalogListings(many(4));
    const paths = listings.map((listing) => listing.path);
    expect(paths).toContain('/vacancies/berlin');
    expect(paths).toContain('/vacancies/berlin/frontend-developer');
  });

  it('сводит разные формулировки одной роли в один список', () => {
    const listings = catalogListings([
      ...many(2, { title: 'Senior Frontend Developer' }),
      ...many(2, { title: 'Разработчик интерфейсов', key: 'ru' }),
    ]);
    const role = listings.find((listing) => listing.role === 'frontend-developer');
    expect(role?.count).toBe(4);
  });

  it('называет удалённые вакансии местом «remote»', () => {
    const listings = catalogListings(many(3, { isRemote: true, location: undefined }));
    expect(listings.map((l) => l.path)).toContain('/vacancies/remote');
  });

  it('переводит русский город, а не транслитерирует', () => {
    const listings = catalogListings(many(3, { location: 'Москва' }));
    expect(listings.map((l) => l.path)).toContain('/vacancies/moscow');
    expect(JSON.stringify(listings)).not.toContain('moskva');
  });

  it('пропускает вакансию, место которой нельзя назвать по-английски', () => {
    expect(catalogListings(many(5, { location: 'Урюпинск' }))).toHaveLength(0);
  });

  it('называет место и роль словами для заголовка страницы', () => {
    const listings = catalogListings(many(3, { location: 'Москва' }));
    const place = listings.find((listing) => listing.path === '/vacancies/moscow');
    expect(place?.placeLabel).toBe('Москва');
    const role = listings.find((listing) => listing.role === 'frontend-developer');
    expect(role?.roleLabel).toBe('Frontend Developer');
  });

  it('отдаёт вакансии выбранного списка', () => {
    const pool = [
      ...many(3, { location: 'Berlin' }),
      ...many(3, { location: 'Amsterdam', key: 'a' }),
    ];
    const berlin = listingEntries(pool, { place: 'berlin' });
    expect(berlin).toHaveLength(3);
    expect(listingEntries(pool, { place: 'berlin', role: 'frontend-developer' })).toHaveLength(3);
    expect(listingEntries(pool, { place: 'lisbon' })).toHaveLength(0);
  });

  it('сортирует списки по величине, чтобы крупные были на виду', () => {
    const listings = catalogListings([
      ...many(3, { location: 'Berlin' }),
      ...many(6, { location: 'Amsterdam', key: 'a' }),
    ]);
    expect(listings[0].count).toBeGreaterThanOrEqual(listings[listings.length - 1].count);
  });
});
