/**
 * CPO 27.10: курсы ЦБ для пересчёта порога фильтра «Зарплата». Процесс
 * обслуживания раз в сутки забирает XML ЦБ и пишет таблицу, веб читает её в
 * фоне и держит в памяти: HTTP наружу не ходит.
 */
import type { DatabaseSync } from 'node:sqlite';
import type { CurrencyRates } from '../../shared/currencyRates';

const CURRENCY_RATES_TABLE = `
CREATE TABLE IF NOT EXISTS currency_rates (
  code TEXT PRIMARY KEY,
  rub_per_unit REAL NOT NULL,
  rate_date TEXT NOT NULL,
  fetched_at TEXT NOT NULL
) STRICT;
`;

function russianNumber(text: string | undefined): number | undefined {
  if (!text) return undefined;
  const value = Number(text.trim().replace(',', '.'));
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function tag(block: string, name: string): string | undefined {
  return new RegExp(`<${name}>([^<]*)</${name}>`).exec(block)?.[1];
}

/** XML_daily.asp ЦБ → рублей за одну единицу; undefined, если курсов на странице нет. */
export function parseCbrDailyXml(xml: string): CurrencyRates | undefined {
  const dateMatch = /<ValCurs[^>]*Date="(\d{2})\.(\d{2})\.(\d{4})"/.exec(xml);
  if (!dateMatch) return undefined;
  const rubPerUnit: Record<string, number> = {};
  for (const block of xml.match(/<Valute[\s\S]*?<\/Valute>/g) ?? []) {
    const code = tag(block, 'CharCode')?.trim();
    const unit = russianNumber(tag(block, 'VunitRate'));
    const value = russianNumber(tag(block, 'Value'));
    const nominal = russianNumber(tag(block, 'Nominal'));
    const rate = unit ?? (value && nominal ? value / nominal : undefined);
    if (code && /^[A-Z]{3}$/.test(code) && rate) rubPerUnit[code] = rate;
  }
  if (Object.keys(rubPerUnit).length === 0) return undefined;
  return { date: `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`, rubPerUnit };
}

export function writeCurrencyRates(database: DatabaseSync, rates: CurrencyRates, now: Date): void {
  database.exec(CURRENCY_RATES_TABLE);
  const insert = database.prepare(
    'INSERT INTO currency_rates (code, rub_per_unit, rate_date, fetched_at) VALUES (?, ?, ?, ?)',
  );
  database.exec('BEGIN');
  try {
    database.exec('DELETE FROM currency_rates');
    for (const [code, rate] of Object.entries(rates.rubPerUnit)) {
      insert.run(code, rate, rates.date, now.toISOString());
    }
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

export function readCurrencyRates(database: DatabaseSync): CurrencyRates | undefined {
  const exists = database
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'currency_rates'")
    .get();
  if (!exists) return undefined;
  const rows = database
    .prepare('SELECT code, rub_per_unit, rate_date FROM currency_rates ORDER BY code')
    .all() as { code: string; rub_per_unit: number; rate_date: string }[];
  if (rows.length === 0) return undefined;
  return {
    date: rows[0].rate_date,
    rubPerUnit: Object.fromEntries(rows.map((row) => [row.code, Number(row.rub_per_unit)])),
  };
}

let current: CurrencyRates | undefined;

export function getCurrencyRates(): CurrencyRates | undefined {
  return current;
}

/** Пустое чтение не стирает известные курсы. */
export function setCurrencyRates(next: CurrencyRates | undefined): void {
  if (next) current = next;
}
