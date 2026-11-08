import { describe, expect, it } from 'vitest';
import { countryPoolPay } from './countryPoolPay';
import { boardHost } from './countryCatalog';
import { MIN_COUNTRY_POOL_SAMPLE } from '../../shared/salaryCountryCities';
import { salaryCountryPathForPlace } from '../../shared/salaryPublicPages';

const at = '2026-11-08T10:00:00.000Z';
const ranges = (n: number, from: number, to: number, sign: string) =>
  Array.from({ length: n }, (_, i) => `${from + i * 1000} — ${to + i * 1000} ${sign}`);

describe('countryPoolPay (SEO P2)', () => {
  it('publishes nothing below the sample threshold', () => {
    expect(
      countryPoolPay(ranges(MIN_COUNTRY_POOL_SAMPLE - 1, 100_000, 150_000, '$'), at),
    ).toBeUndefined();
  });
  it('reads yearly dollars and keeps sample, sources and date', () => {
    const pay = countryPoolPay(
      [...ranges(MIN_COUNTRY_POOL_SAMPLE, 100_000, 150_000, '$'), 'от 90 000 $', '20 — 30 $'],
      at,
      ['Greenhouse', 'Lever', 'Greenhouse'],
    );
    expect(pay).toMatchObject({ sign: '$', period: 'year', sampleSize: MIN_COUNTRY_POOL_SAMPLE });
    expect(pay?.withSalary).toBe(MIN_COUNTRY_POOL_SAMPLE + 2);
    expect(pay?.sources).toEqual(['Greenhouse', 'Lever']);
    expect(pay?.median).toBe(140_000);
    expect(pay?.readAt).toBe(at);
  });
  it('does not mix monthly and yearly figures of one currency', () => {
    const pay = countryPoolPay(
      [...Array(40).fill('4 000 — 6 000 €'), ...Array(31).fill('60 000 — 80 000 €')],
      at,
    );
    expect(pay).toMatchObject({ period: 'month', sampleSize: 40 });
  });
  it('names the board by host, not the employer', () => {
    expect(boardHost('https://boards.greenhouse.io/airbnb/jobs/1')).toBe('greenhouse.io');
    expect(boardHost('https://hh.ru/vacancy/1')).toBe('hh.ru');
    expect(boardHost('not a url')).toBe('');
  });
  it('maps catalog cities to their country page', () => {
    expect(salaryCountryPathForPlace('berlin')?.path).toBe('/salaries/germany');
    expect(salaryCountryPathForPlace('new-york')).toEqual({
      path: '/salaries/usa',
      name: 'Зарплаты в США',
    });
    expect(salaryCountryPathForPlace('moscow')).toBeUndefined();
  });
});
