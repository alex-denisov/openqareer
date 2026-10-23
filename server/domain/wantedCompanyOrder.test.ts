import { describe, expect, it } from 'vitest';
import { candidateCompanyKey } from './candidateCompanies';
import { wantedCompaniesFirst } from './wantedCompanyOrder';

const item = (id: string, company?: string) => ({ cluster: { id, canonicalCompany: company } });

describe('B422: вакансии компаний «Хочу» — первыми в подборке', () => {
  it('поднимает вакансии отмеченных компаний, сохраняя порядок внутри групп', () => {
    const items = [item('a', 'Acme'), item('b', 'Yandex'), item('c'), item('d', 'yandex ')];
    const ordered = wantedCompaniesFirst(items, new Set([candidateCompanyKey('Yandex')]));
    expect(ordered.map((entry) => entry.cluster.id)).toEqual(['b', 'd', 'a', 'c']);
  });

  it('без отметок порядок не меняется', () => {
    const items = [item('a', 'Acme'), item('b', 'Yandex')];
    expect(wantedCompaniesFirst(items, new Set())).toEqual(items);
  });
});
