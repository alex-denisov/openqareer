import { describe, expect, it } from 'vitest';
import { candidateCompanyKey } from './candidateCompanies';
import { wantedCompaniesBreakTies } from './wantedCompanyOrder';

const item = (id: string, place: number, company?: string) => ({
  cluster: { id, canonicalCompany: company },
  place,
});
const byPlace = (left: { place: number }, right: { place: number }) => left.place - right.place;

describe('28.10: «Хочу» — второй ключ после процента', () => {
  it('поднимает отмеченную компанию только среди равных, сохраняя порядок внутри групп', () => {
    const items = [
      item('a', 1, 'Acme'),
      item('b', 2, 'Other'),
      item('c', 2, 'yandex '),
      item('d', 3),
    ];
    const ordered = wantedCompaniesBreakTies(
      items,
      new Set([candidateCompanyKey('Yandex')]),
      byPlace,
    );
    expect(ordered.map((entry) => entry.cluster.id)).toEqual(['a', 'c', 'b', 'd']);
  });

  it('без отметок порядок не меняется', () => {
    const items = [item('a', 2, 'Acme'), item('b', 1, 'Yandex')];
    expect(wantedCompaniesBreakTies(items, new Set(), byPlace)).toEqual(items);
  });
});
