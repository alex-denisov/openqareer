import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';
import { iscoOfFunction } from './iscoOfFunction';
import { countryEarning, writeOpenStatistics } from './occupationEarningStore';
import { refreshOpenStatistics, refreshWhenDue } from './occupationEarningSchedule';
import { parseIlostat, parseWdi } from './openStatistics';

const HEADER =
  '\uFEFF"ref_area","source","indicator","sex","classif1","classif2","time","obs_value","obs_status","note_classif","note_indicator","note_source"';
const line = (area: string, group: string, year: number, value: number | '', status = '') =>
  `"${area}","BA:1","EAR","SEX_T","OCU_ISCO08_${group}","CUR_TYPE_USD","${year}",${value},${
    status ? `"${status}"` : ''
  },,"T30:110","R1:3513"`;

describe('parseIlostat', () => {
  it('keeps the newest reliable value of a major group', () => {
    const csv = [
      HEADER,
      line('USA', '1', 2024, 9000),
      line('USA', '1', 2025, 10000.5),
      line('USA', '1', 2026, 99, 'U'),
      line('USA', 'X', 2025, 5),
      line('USA', '2', 2025, ''),
      line('DEU', 'TOTAL', 2022, 4600, 'B'),
      '',
    ].join('\n');
    expect(parseIlostat(csv)).toEqual([
      { iso3: 'USA', isco: '1', year: 2025, monthlyUsd: 10000.5 },
      { iso3: 'DEU', isco: 'TOTAL', year: 2022, monthlyUsd: 4600 },
    ]);
  });
});

const wdiRow = (id: string, iso3: string, date: string, value: number | null) => ({
  country: { id, value: id },
  countryiso3code: iso3,
  date,
  value,
});

describe('parseWdi', () => {
  it('takes the newest known income', () => {
    expect(
      parseWdi([
        { pages: 1 },
        [wdiRow('AE', 'ARE', '2025', null), wdiRow('AE', 'ARE', '2024', 51550)],
      ]),
    ).toEqual([{ iso2: 'AE', iso3: 'ARE', year: 2024, perCapitaUsd: 51550 }]);
    expect(() => parseWdi({ message: 'error' })).toThrow();
  });
});

const letters = (index: number) =>
  `${String.fromCharCode(65 + Math.floor(index / 26))}${String.fromCharCode(65 + (index % 26))}`;
const filler = Array.from({ length: 60 }, (_, index) => `${letters(index)}`).filter(
  (code) => !['AE'].includes(code),
);
function statistics() {
  const incomes = [
    ...filler.map((code) => ({ iso2: code, iso3: `${code}X`, year: 2024, perCapitaUsd: 12_000 })),
    { iso2: 'SA', iso3: 'SAU', year: 2024, perCapitaUsd: 24_000 },
    { iso2: 'QA', iso3: 'QAT', year: 2024, perCapitaUsd: 60_000 },
    { iso2: 'AE', iso3: 'ARE', year: 2024, perCapitaUsd: 48_000 },
  ];
  const earnings = [
    ...filler.map((code) => ({ iso3: `${code}X`, isco: '1', year: 2024, monthlyUsd: 1000 })),
    { iso3: 'SAU', isco: '1', year: 2022, monthlyUsd: 4000 },
    { iso3: 'QAT', isco: '1', year: 2022, monthlyUsd: 12_500 },
    { iso3: 'ZZZ', isco: '1', year: 2022, monthlyUsd: 1 },
  ];
  return { incomes, earnings };
}

describe('countryEarning', () => {
  it('answers directly, by neighbours with the income correction, or not at all', () => {
    const database = new DatabaseSync(':memory:');
    expect(countryEarning(database, 'SA', '1', [])).toBeUndefined();
    const { incomes, earnings } = statistics();
    writeOpenStatistics(database, earnings, incomes);
    expect(countryEarning(database, 'SA', '1', ['QA'])).toEqual({
      monthlyUsd: 4000,
      year: 2022,
      basis: 'direct',
    });
    // Доля дохода: SA 2, QA 2,5 → медиана 2,25; 48 000 / 12 × 2,25.
    expect(countryEarning(database, 'AE', '1', ['AE', 'SA', 'QA', 'KW'])).toEqual({
      monthlyUsd: 9000,
      year: 2024,
      basis: 'adjusted',
    });
    expect(countryEarning(database, 'AE', '1', ['SA'])).toBeUndefined();
    expect(countryEarning(database, 'AE', '2', ['SA', 'QA'])).toBeUndefined();
  });

  it('keeps the tables when the answer is cut or fails', async () => {
    const database = new DatabaseSync(':memory:');
    const { incomes, earnings } = statistics();
    writeOpenStatistics(database, earnings, incomes);
    const log = { info: vi.fn(), error: vi.fn() };
    expect(database.prepare('SELECT DISTINCT license FROM open_statistics_sources').all()).toEqual([
      { license: 'CC BY 4.0' },
    ]);
    const huge = async () => new Response('x'.repeat(17 * 1024 * 1024));
    expect(await refreshOpenStatistics(database, log, huge)).toBe(false);
    const short = async (url: string) =>
      new Response(url.includes('ilo') ? `${HEADER}\n` : JSON.stringify([{ pages: 1 }, []]));
    expect(await refreshOpenStatistics(database, log, short)).toBe(false);
    expect(
      await refreshOpenStatistics(database, log, async () => new Response('', { status: 503 })),
    ).toBe(false);
    expect(countryEarning(database, 'SA', '1', [])?.monthlyUsd).toBe(4000);
  });
});

describe('refreshWhenDue', () => {
  it('waits a week after a load and asks again after a failure', async () => {
    const database = new DatabaseSync(':memory:');
    const log = { info: vi.fn(), error: vi.fn() };
    const down = vi.fn(async () => new Response('', { status: 503 }));
    expect(await refreshWhenDue(database, log, down)).toBe(false);
    const { incomes, earnings } = statistics();
    writeOpenStatistics(database, earnings, incomes);
    expect(await refreshWhenDue(database, log, down)).toBe(true);
    expect(down).toHaveBeenCalledOnce();
    database.exec("UPDATE open_statistics_sources SET loaded_at = '2020-01-01T00:00:00Z'");
    expect(await refreshWhenDue(database, log, down)).toBe(false);
  });
});

describe('iscoOfFunction', () => {
  it('sends managers to group 1 and the unknown to the total', () => {
    expect(iscoOfFunction('eng', 0)).toBe('2');
    expect(iscoOfFunction('support', 2)).toBe('1');
    expect(iscoOfFunction('other', null)).toBe('TOTAL');
  });
});
