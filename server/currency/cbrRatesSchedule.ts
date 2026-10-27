/**
 * CPO 27.10: курсы ЦБ раз в сутки.
 * - Процесс обслуживания: забрать XML ЦБ (зеркало, если ЦБ не отвечает) и записать таблицу.
 * - Веб: раз в 15 минут прочитать таблицу в память.
 */
import { DatabaseSync } from 'node:sqlite';
import type { CurrencyRates } from '../../shared/currencyRates';
import { applySqliteBusyTimeout } from '../data/sqliteBusyTimeout';
import {
  parseCbrDailyXml,
  readCurrencyRates,
  setCurrencyRates,
  writeCurrencyRates,
} from './cbrRates';

interface RatesLog {
  info(details: Record<string, unknown>, message: string): void;
  error(details: Record<string, unknown>, message: string): void;
}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

const CBR_SOURCES = [
  { url: 'https://www.cbr.ru/scripts/XML_daily.asp', encoding: 'windows-1251' },
  { url: 'https://www.cbr-xml-daily.ru/daily_utf8.xml', encoding: 'utf-8' },
] as const;
const FETCH_TIMEOUT_MS = 20_000;
const JOB_FIRST_RUN_MS = 90_000;
const JOB_INTERVAL_MS = 24 * 60 * 60_000;
const RETRY_INTERVAL_MS = 60 * 60_000;
const REFRESH_INTERVAL_MS = 15 * 60_000;

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'UnknownError';
}

async function fetchSource(
  fetchImpl: Fetch,
  source: (typeof CBR_SOURCES)[number],
): Promise<CurrencyRates | undefined> {
  const response = await fetchImpl(source.url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!response.ok) return undefined;
  const xml = new TextDecoder(source.encoding).decode(await response.arrayBuffer());
  return parseCbrDailyXml(xml);
}

/** Курсы с ЦБ, при отказе — с зеркала; undefined, если оба не дали курсов. */
export async function fetchCbrRates(
  fetchImpl: Fetch = fetch,
  log?: RatesLog,
): Promise<CurrencyRates | undefined> {
  for (const source of CBR_SOURCES) {
    try {
      const rates = await fetchSource(fetchImpl, source);
      if (rates) return rates;
      log?.error({ url: source.url }, 'currency-rates-empty');
    } catch (error: unknown) {
      log?.error({ url: source.url, errorName: errorName(error) }, 'currency-rates-fetch-failed');
    }
  }
  return undefined;
}

/** Процесс обслуживания: раз в сутки, при неудаче — повтор через час. */
export function scheduleCurrencyRatesJob(database: DatabaseSync, log: RatesLog): () => void {
  let timer: NodeJS.Timeout | undefined;
  let stopped = false;
  const plan = (delay: number) => {
    if (stopped) return;
    timer = setTimeout(() => void run(), delay);
    timer.unref();
  };
  const run = async () => {
    const rates = await fetchCbrRates(fetch, log);
    if (!rates) return plan(RETRY_INTERVAL_MS);
    try {
      writeCurrencyRates(database, rates, new Date());
      log.info(
        { date: rates.date, codes: Object.keys(rates.rubPerUnit).length },
        'currency-rates-written',
      );
    } catch (error: unknown) {
      log.error({ errorName: errorName(error) }, 'currency-rates-write-failed');
    }
    plan(JOB_INTERVAL_MS);
  };
  plan(JOB_FIRST_RUN_MS);
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}

/** Веб: чтение маленькой таблицы в память. */
export function scheduleCurrencyRatesRefresh(databasePath: string, log: RatesLog): () => void {
  const refresh = () => {
    let database: DatabaseSync | undefined;
    try {
      database = new DatabaseSync(databasePath, { readOnly: true });
      applySqliteBusyTimeout(database);
      setCurrencyRates(readCurrencyRates(database));
    } catch (error: unknown) {
      log.error({ errorName: errorName(error) }, 'currency-rates-refresh-failed');
    } finally {
      database?.close();
    }
  };
  refresh();
  const every = setInterval(refresh, REFRESH_INTERVAL_MS);
  every.unref();
  return () => clearInterval(every);
}
