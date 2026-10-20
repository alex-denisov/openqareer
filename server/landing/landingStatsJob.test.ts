import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  cleanLandingTitle,
  computeLandingStats,
  formatLandingSalary,
  isLandingTitle,
  landingCountry,
  pickLandingVacancies,
  readLandingStats,
  writeLandingStats,
} from './landingStatsJob';

describe('formatLandingSalary', () => {
  it('formats yearly foreign, monthly rouble and open-ended salaries like the mockup', () => {
    expect(formatLandingSalary({ from: 212000, to: 265000, currency: 'USD' })).toBe(
      '$212–265 тыс. в год',
    );
    expect(formatLandingSalary({ from: 220000, to: 250000, currency: 'RUR' })).toBe(
      '220–250 тыс. ₽ в месяц',
    );
    expect(formatLandingSalary({ from: 5000, to: 6000, currency: 'EUR' })).toBe(
      '€5–6 тыс. в месяц',
    );
    expect(formatLandingSalary({ from: 4500, currency: 'USD' })).toBe('от $4,5 тыс. в месяц');
  });

  it('drops hourly amounts, unknown currencies and empty salaries', () => {
    expect(formatLandingSalary({ from: 20, to: 25, currency: 'USD' })).toBeNull();
    expect(formatLandingSalary({ from: 1000000, currency: 'KZT' })).toBeNull();
    expect(formatLandingSalary(null)).toBeNull();
  });
});

describe('landingCountry', () => {
  it('reads the country from currency first, then from the location', () => {
    expect(landingCountry({ salary: { currency: 'RUR' }, location: 'Казань' })).toBe('Россия');
    expect(landingCountry({ salary: { currency: 'USD' }, location: 'United States' })).toBe('США');
    expect(landingCountry({ salary: { currency: 'EUR' }, location: 'Germany; Netherlands' })).toBe(
      'Германия',
    );
    expect(landingCountry({ salary: { currency: 'USD' }, location: 'Remote' })).toBeNull();
  });
});

describe('pickLandingVacancies', () => {
  it('keeps only salaried rows with a country, distinct titles, and never a company', () => {
    const rows = pickLandingVacancies([
      {
        title: 'Analytics Engineer',
        salary: { from: 164200, to: 229990, currency: 'USD' },
        location: 'United States',
        company: 'Reddit',
      } as never,
      {
        title: 'Analytics Engineer',
        salary: { from: 1, to: 2, currency: 'USD' },
        location: 'United States',
      },
      { title: 'Dentist', location: 'United States' },
      {
        title: 'Главный бухгалтер',
        salary: { from: 120000, to: 150000, currency: 'RUR' },
        location: 'Пятигорск',
      },
    ]);
    expect(rows).toEqual([
      { title: 'Analytics Engineer', salary: '$164–230 тыс. в год', country: 'США' },
      { title: 'Главный бухгалтер', salary: '120–150 тыс. ₽ в месяц', country: 'Россия' },
    ]);
    expect(JSON.stringify(rows)).not.toContain('Reddit');
  });
});

function poolDatabase(): DatabaseSync {
  const database = new DatabaseSync(':memory:');
  database.exec(`CREATE TABLE vacancy_pool (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
    CREATE TABLE vacancy_pool_index (id TEXT PRIMARY KEY, source_id TEXT, published_ms INTEGER,
      is_active INTEGER, is_remote INTEGER, expired INTEGER);`);
  const insertPool = database.prepare('INSERT INTO vacancy_pool VALUES (?, ?)');
  const insertIndex = database.prepare('INSERT INTO vacancy_pool_index VALUES (?, ?, ?, 1, ?, 0)');
  for (let index = 0; index < 10; index += 1) {
    const id = `v${index}`;
    insertPool.run(
      id,
      JSON.stringify({
        title: `Product Manager ${index}`,
        salary: { from: 100000 + index * 1000, to: 150000, currency: 'RUR' },
        location: 'Москва',
      }),
    );
    insertIndex.run(
      id,
      index % 3 === 0 ? 'src-hh-search' : 'src-b',
      1_000 + index,
      index < 8 ? 1 : 0,
    );
  }
  return database;
}

describe('landing stats round trip', () => {
  it('counts the pool, keeps seven rows and reads them back by primary key', () => {
    const database = poolDatabase();
    expect(readLandingStats(database)).toBeNull();
    const now = new Date('2026-10-21T09:00:00Z');
    const stats = computeLandingStats(database, now);
    expect(stats).toMatchObject({
      activeCount: 10,
      remoteCount: 8,
      sourceCount: 2,
      updatedAt: '2026-10-21',
    });
    expect(stats.vacancies).toHaveLength(7);
    // International and hh.ru rows alternate, newest first.
    expect(stats.vacancies.map((row) => row.title).slice(0, 2)).toEqual([
      'Product Manager 7',
      'Product Manager 6',
    ]);
    writeLandingStats(database, stats, now);
    expect(readLandingStats(database)).toEqual(stats);
  });
});

describe('isLandingTitle', () => {
  it('keeps professional roles and drops noise listings', () => {
    expect(isLandingTitle('Руководитель отдела продаж')).toBe(true);
    expect(isLandingTitle('Analytics Engineer')).toBe(true);
    expect(isLandingTitle('In-Home Traveler Physician Full Time - Oregon')).toBe(false);
    expect(isLandingTitle('Sales Closer')).toBe(false);
    expect(isLandingTitle('Music Teacher - Remote Job')).toBe(false);
  });
});

describe('isLandingTitle and Cyrillic word parts', () => {
  it('does not mistake «руководитель» for «водитель»', () => {
    expect(isLandingTitle('Руководитель разработки')).toBe(true);
    expect(isLandingTitle('Водитель-экспедитор, менеджер')).toBe(false);
  });
});

describe('cleanLandingTitle', () => {
  it('drops board hashtags and keeps the role', () => {
    expect(cleanLandingTitle('(#Удалёнка) Junior Frontend-разработчик (React)')).toBe(
      'Junior Frontend-разработчик (React)',
    );
    expect(cleanLandingTitle('Аналитик данных #remote #fulltime')).toBe('Аналитик данных');
  });
});
