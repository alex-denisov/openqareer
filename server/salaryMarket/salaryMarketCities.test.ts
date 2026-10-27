import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { monthlyMidpointOf, salaryCityOf } from './salaryMarketCities';
import { computeSalaryMarketSnapshots } from './salaryMarketSnapshot';

const now = new Date('2026-10-27T00:00:00Z');
const hhMonth = { field: 'hh.compensation.mode', value: 'MONTH' };

function database() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE catalog_entries (cluster_id TEXT PRIMARY KEY, title TEXT, role_slug TEXT,
    skills_json TEXT, published_ms INTEGER, status TEXT, location TEXT, is_remote INTEGER);
    CREATE TABLE vacancy_clusters (id TEXT PRIMARY KEY, cluster_json TEXT)`);
  return db;
}
function add(
  db: DatabaseSync,
  prefix: string,
  count: number,
  location: string,
  salary: (index: number) => Record<string, unknown> | undefined,
  remote = false,
) {
  for (let index = 0; index < count; index += 1) {
    const id = `${prefix}-${index}`;
    db.prepare('INSERT INTO catalog_entries VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
      id,
      'Главный бухгалтер',
      'accountant',
      '[]',
      now.getTime(),
      'active',
      location,
      Number(remote),
    );
    db.prepare('INSERT INTO vacancy_clusters VALUES (?, ?)').run(
      id,
      JSON.stringify({ salary: salary(index) }),
    );
  }
}
const rub = (from: number, to: number) => ({
  from,
  to,
  currency: 'RUR',
  gross: true,
  period: 'month',
  periodEvidence: hhMonth,
});

describe('salary city market (B351)', () => {
  it('publishes midpoint percentiles per city and hides places under 20 ranges', () => {
    const db = database();
    add(db, 'msk', 40, 'Москва, м. Арбатская', (i) => rub(100_000 + i * 1000, 120_000 + i * 1000));
    add(db, 'msk-open', 5, 'Москва', () => ({
      from: 90_000,
      currency: 'RUR',
      period: 'month',
      periodEvidence: hhMonth,
    }));
    add(db, 'msk-legacy', 5, 'Москва', () => ({ from: 90_000, to: 95_000, currency: 'RUR' }));
    add(db, 'kzn', 19, 'Казань', (i) => rub(60_000 + i, 70_000 + i));
    add(db, 'rem', 30, 'Anywhere', () => ({ ...rub(4000, 6000), currency: 'USD' }), true);
    const [snapshot] = computeSalaryMarketSnapshots(db, now);
    const market = snapshot!.cityMarket!;
    expect(market.minSample).toBe(20);
    expect(market.cities.map((city) => city.city)).toEqual(['Москва']);
    const moscow = market.cities[0]!;
    expect(moscow.vacancyCount).toBe(50);
    expect(moscow.salary).toMatchObject({ currency: 'RUR', taxBasis: 'gross', sampleSize: 40 });
    // midpoints 110 000 … 149 000, nearest rank
    expect(moscow.salary.p25).toBe(119_000);
    expect(moscow.salary.p50).toBe(129_000);
    expect(moscow.salary.p75).toBe(139_000);
    expect(market.remote?.salary).toMatchObject({ currency: 'USD', p50: 5000, sampleSize: 30 });
    expect(market.rangedTotal).toBe(40 + 19 + 30);
    expect(market.publishedSample).toBe(40);
  });

  it('never mixes tax bases or currencies inside one city', () => {
    const db = database();
    add(db, 'gross', 30, 'Москва', () => rub(100_000, 100_000));
    add(db, 'net', 31, 'Москва', () => ({ ...rub(80_000, 80_000), gross: false }));
    const moscow = computeSalaryMarketSnapshots(db, now)[0]!.cityMarket!.cities[0]!;
    expect(moscow.salary).toMatchObject({ taxBasis: 'net', sampleSize: 31, p50: 80_000 });
  });
});

describe('salary city inputs', () => {
  it('takes the first location token and keeps remote apart', () => {
    expect(salaryCityOf('Санкт-Петербург, Невский проспект', false)?.label).toBe('Санкт-Петербург');
    expect(salaryCityOf('Москва, м. Арбатская', false)?.slug).toBe('moscow');
    expect(salaryCityOf(null, true)?.slug).toBe('remote');
    expect(salaryCityOf(null, false)).toBeUndefined();
  });

  it('accepts only closed ranges with a proven monthly period', () => {
    expect(monthlyMidpointOf(JSON.stringify(rub(100, 200)))?.midpoint).toBe(150);
    expect(
      monthlyMidpointOf(JSON.stringify({ from: 100, to: 200, currency: 'RUR' })),
    ).toBeUndefined();
    expect(
      monthlyMidpointOf(
        JSON.stringify({
          ...rub(100, 200),
          period: 'year',
          periodEvidence: { field: 'himalayas.salaryPeriod', value: 'annual' },
        }),
      ),
    ).toBeUndefined();
    expect(monthlyMidpointOf('not json')).toBeUndefined();
  });
});
