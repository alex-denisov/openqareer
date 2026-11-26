/**
 * B803: рост цен страны (World Bank, WDI, CC BY 4.0) приводит цифру прежнего года к последнему
 * известному. Записи источников не меняются: поправка живёт только в таблице подбора.
 */
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import type { SalaryBenchmark } from './salaryBenchmark';

export const PRICES_URL =
  'https://api.worldbank.org/v2/country/all/indicator/FP.CPI.TOTL.ZG?format=json&date=2015:2035&per_page=20000';

export const PRICE_TABLE_SQL = `CREATE TABLE IF NOT EXISTS country_prices (
  country TEXT NOT NULL, year INTEGER NOT NULL, growth_percent REAL NOT NULL,
  PRIMARY KEY (country, year)
) STRICT, WITHOUT ROWID`;

export interface PriceGrowth {
  readonly country: string;
  readonly year: number;
  readonly percent: number;
}

/** Меньше этого — ответ источника обрезан: прежняя таблица остаётся. */
const MIN_COUNTRIES = 100;
/** Рост сильнее вдвое говорит о смене денег, а не о ценах: такую цифру не поправляем. */
const MAX_FACTOR = 2;
const EURO_AREA = new Set('AT BE CY DE EE ES FI FR GR HR IE IT LT LU LV MT NL PT SI SK'.split(' '));

const wdiSchema = z.tuple([
  z.object({ pages: z.literal(1) }),
  z.array(
    z.object({
      country: z.object({ id: z.string() }),
      date: z.string(),
      value: z.number().nullable(),
    }),
  ),
]);

export function parsePrices(json: unknown): PriceGrowth[] {
  const [, rows] = wdiSchema.parse(json);
  return rows.flatMap(({ country, date, value }) =>
    value !== null && /^[A-Z]{2}$/u.test(country.id)
      ? [{ country: country.id, year: Number(date), percent: value }]
      : [],
  );
}

export function writePrices(database: DatabaseSync, rows: readonly PriceGrowth[]): void {
  if (new Set(rows.map(({ country }) => country)).size < MIN_COUNTRIES)
    throw new Error('price answer is incomplete');
  database.exec(PRICE_TABLE_SQL);
  const insert = database.prepare(
    `INSERT INTO country_prices VALUES (?, ?, ?)
      ON CONFLICT (country, year) DO UPDATE SET growth_percent = excluded.growth_percent`,
  );
  database.exec('BEGIN IMMEDIATE');
  try {
    for (const { country, year, percent } of rows) insert.run(country, year, percent);
    database.exec('COMMIT');
  } catch (error: unknown) {
    database.exec('ROLLBACK');
    throw error;
  }
}

/** Цены страны поправляют только её деньги: оклад в долларах вне США от местных цен не растёт. */
const ownCurrency = (country: string, currency: string): boolean =>
  currency === 'EUR' ? EURO_AREA.has(country) : currency.startsWith(country);

export type ApplyPrices = (row: SalaryBenchmark) => SalaryBenchmark;

export function pricesOf(database: DatabaseSync): ApplyPrices {
  const growth = database.prepare(
    'SELECT growth_percent AS percent FROM country_prices WHERE country = ? AND year = ?',
  );
  const factorOf = (country: string, from: number): number => {
    let factor = 1;
    for (let year = from + 1; ; year += 1) {
      const row = growth.get(country, year) as { percent: number } | undefined;
      if (!row) return factor;
      factor *= 1 + row.percent / 100;
    }
  };
  return (row) => {
    if (!row.country || !ownCurrency(row.country, row.currency)) return row;
    const factor = factorOf(row.country, row.year);
    if (factor <= 1 || factor > MAX_FACTOR) return row;
    const grown = (value: number | null) => (value === null ? null : Math.round(value * factor));
    return { ...row, low: grown(row.low), median: grown(row.median), high: grown(row.high) };
  };
}
