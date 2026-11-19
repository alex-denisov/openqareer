/**
 * B653 C06: вилки места для «Релокации» поверх готовых расчётов каталога — пула
 * страны (`countryPoolPay`, порог MIN_COUNTRY_POOL_SAMPLE) и списков города
 * (`catalog_salary_stats`). Нового расчёта вилки здесь нет: только перевод в
 * валюту налогов страны по курсу ЦБ и в месяц. Без выборки, даты и источника
 * цифра не отдаётся — ниже порога ответ «мало данных».
 */
import { convertAmount, currencyCode, type CurrencyRates } from '../../shared/currencyRates';
import type { CountryCatalog } from '../../shared/salaryCountryCities';
import type { SalaryStats } from '../vacancies/catalogSalaryStats';

/** Меньше вилок у роли в городе — берём весь город; меньше и у города — «мало данных». */
export const MIN_CITY_PAY_SAMPLE = 8;
const MONTHS = 12;

export type CountryPay =
  | {
      readonly state: 'ready';
      readonly currency: string;
      readonly low: number;
      readonly median: number;
      readonly high: number;
      readonly sampleSize: number;
      readonly observedAt: string;
      /** Дата курса ЦБ, если вилку пришлось перевести из другой валюты. */
      readonly rateDate: string | null;
      readonly sources: readonly string[];
      readonly vacancies: number;
      readonly city: string | null;
    }
  | { readonly state: 'thin'; readonly vacancies: number; readonly city: string | null };

export type CityPay =
  | {
      readonly state: 'ready';
      readonly scope: 'role' | 'city';
      readonly currency: 'RUB';
      readonly low: number;
      readonly median: number;
      readonly high: number;
      readonly sampleSize: number;
      readonly observedAt: string;
    }
  | { readonly state: 'thin' };

export interface StoredStats {
  readonly stats: SalaryStats;
  readonly computedAt: string;
}

const roundMoney = (value: number): number =>
  value >= 10_000 ? Math.round(value / 1000) * 1000 : Math.round(value);

export function countryPay(
  catalog: CountryCatalog | null,
  currency: string,
  rates: CurrencyRates | undefined,
): CountryPay {
  const cities = [...(catalog?.cities ?? [])].sort((a, b) => b.count - a.count);
  const place = {
    vacancies: cities.reduce((sum, city) => sum + city.count, 0),
    city: cities[0]?.slug ?? null,
  };
  const pay = catalog?.pay;
  if (!pay) return { state: 'thin', ...place };
  const months = pay.period === 'year' ? MONTHS : 1;
  const local = (value: number) => convertAmount(value / months, pay.sign, currency, rates);
  const [low, median, high] = [pay.low, pay.median, pay.high].map(local);
  if (low === undefined || median === undefined || high === undefined)
    return { state: 'thin', ...place };
  const converted = currencyCode(pay.sign) !== currencyCode(currency);
  return {
    state: 'ready',
    currency,
    low: roundMoney(low),
    median: roundMoney(median),
    high: roundMoney(high),
    sampleSize: pay.sampleSize,
    observedAt: pay.readAt,
    rateDate: converted ? (rates?.date ?? null) : null,
    sources: pay.sources,
    ...place,
  };
}

function monthlyRub(stored: StoredStats | null, scope: 'role' | 'city'): CityPay | null {
  const group = stored?.stats.groups?.find(
    (item) => item.period === 'month' && currencyCode(item.currency) === 'RUB',
  );
  if (!stored || !group || group.sample < MIN_CITY_PAY_SAMPLE) return null;
  return {
    state: 'ready',
    scope,
    currency: 'RUB',
    low: group.low,
    median: group.median,
    high: group.high,
    sampleSize: group.sample,
    observedAt: stored.computedAt,
  };
}

/** Вилка города России: сначала роль кандидата в городе, затем весь город. */
export function cityPay(role: StoredStats | null, city: StoredStats | null): CityPay {
  return monthlyRub(role, 'role') ?? monthlyRub(city, 'city') ?? { state: 'thin' };
}
