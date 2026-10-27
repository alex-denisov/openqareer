import { describe, expect, it } from 'vitest';
import type { MatchedVacancyItem } from '../coach/cabinetTypes';
import type { CurrencyRates } from '../../../shared/currencyRates';
import { filterByScreenState } from './vacancyScreenCriteria';
import type { VacanciesScreenState } from './vacanciesScreenState';

function item(id: string, salary: { from?: number; to?: number; currency: string }) {
  return {
    cluster: { id, canonicalTitle: 'Head of Engineering', isRemote: false, salary, sources: [] },
    explanation: { clusterId: id },
  } as unknown as MatchedVacancyItem;
}

const items = [
  item('berlin', { from: 6000, to: 7500, currency: 'EUR' }),
  item('moscow', { from: 350_000, currency: 'RUR' }),
  item('almaty', { to: 1_000_000, currency: 'KZT' }),
  item('tbilisi', { from: 5000, currency: 'GEL' }),
];
const rates: CurrencyRates = { date: '2026-10-27', rubPerUnit: { EUR: 90, KZT: 0.16 } };
const base: VacanciesScreenState = {
  roles: [],
  regions: [],
  remoteOnly: false,
  salaryMinimum: 400_000,
  salaryCurrency: 'RUR',
};
const ids = (state: VacanciesScreenState, withRates?: CurrencyRates) =>
  filterByScreenState(items, state, '2026-10-27', withRates).map((entry) => entry.cluster.id);

describe('salary filter across currencies (CPO 27.10)', () => {
  it('converts the threshold by the CBR rate instead of dropping other currencies', () => {
    // 6000–7500 EUR = 540–675 тыс. ₽ ≥ 400 тыс.; 1 млн KZT = 160 тыс. ₽ < 400 тыс.
    expect(ids(base, rates)).toEqual(['berlin']);
    expect(ids({ ...base, salaryMinimum: 150_000 }, rates)).toEqual(['berlin', 'moscow', 'almaty']);
  });

  it('works from a foreign threshold too', () => {
    expect(ids({ ...base, salaryMinimum: 7000, salaryCurrency: 'EUR' }, rates)).toEqual(['berlin']);
  });

  it('treats a currency without a rate as no salary, and compares same currency without rates', () => {
    expect(ids({ ...base, salaryMinimum: 150_000, includeMissingSalary: true }, rates)).toContain(
      'tbilisi',
    );
    expect(ids({ ...base, salaryMinimum: 300_000 })).toEqual(['moscow']);
  });
});
