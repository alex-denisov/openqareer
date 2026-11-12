import { describe, expect, it } from 'vitest';
import {
  agoLabel,
  directShare,
  healthView,
  isStale,
  percentLabel,
  placementName,
  poolTotal,
} from './coverageModel';
import type { CoverageTotals } from './coverageApi';

const TOTALS: CoverageTotals = {
  totalCompanies: 261_964,
  computedAt: 1_000,
  classes: {
    ats: { companies: 134_127, vacancies: 384_143 },
    site: { companies: 20_918, vacancies: 343_073 },
    aggregator_only: { companies: 7_490, vacancies: 71_524 },
    linkedin_only: { companies: 41, vacancies: 1_142 },
    none: { companies: 99_388, vacancies: 0 },
  },
};

describe('coverageModel', () => {
  it('sums the pool and the direct share (ATS + site)', () => {
    expect(poolTotal(TOTALS)).toBe(799_882);
    expect(directShare(TOTALS)).toBe(155_045);
  });

  it('formats percents with a floor for tiny shares', () => {
    expect(percentLabel(0)).toBe('0 %');
    expect(percentLabel(0.02)).toBe('меньше 0,1 %');
    expect(percentLabel(59.18)).toBe('59,2 %');
  });

  it('maps health to words, without time when never checked', () => {
    expect(healthView('healthy')).toEqual({ label: 'работает', tone: 'ok' });
    expect(healthView('error')).toEqual({ label: 'ошибка', tone: 'error' });
    expect(healthView('degraded')).toEqual({ label: 'замедлен', tone: 'warn' });
    expect(healthView(null)).toEqual({ label: 'ещё не проверялось', tone: 'none' });
  });

  it('names a placement: ATS vendor, LinkedIn, or the site domain', () => {
    expect(placementName({ type: 'ats', id: 'ats:greenhouse:spacex', health: null, lastCheckedAt: null })).toBe('Greenhouse');
    expect(placementName({ type: 'ats', id: 'ats:odd:x', health: null, lastCheckedAt: null })).toBe('ATS');
    expect(placementName({ type: 'linkedin', id: 'li:x', health: null, lastCheckedAt: null })).toBe('LinkedIn');
    expect(
      placementName({ type: 'employer_site', id: 'site:src-fh-sber', health: null, lastCheckedAt: null, domain: 'sberbank.ru' }),
    ).toBe('sberbank.ru');
    expect(placementName({ type: 'employer_site', id: 'site:src-fh-x', health: null, lastCheckedAt: null, domain: null })).toBe('Сайт');
  });

  it('says how long ago in minutes, hours, days', () => {
    const now = 10 * 86_400_000;
    expect(agoLabel(now - 7 * 60_000, now)).toBe('7 мин назад');
    expect(agoLabel(now - 3 * 3_600_000, now)).toBe('3 ч назад');
    expect(agoLabel(now - 2 * 86_400_000, now)).toBe('2 дн назад');
  });

  it('marks totals older than ten minutes as stale', () => {
    expect(isStale(0, 9 * 60_000)).toBe(false);
    expect(isStale(0, 11 * 60_000)).toBe(true);
  });
});
