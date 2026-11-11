import { describe, expect, it } from 'vitest';
import { normalizeJsonSource } from './jsonSourceAdapters';

const OBSERVED_AT = '2026-11-11T12:00:00.000Z';

describe('Работа России adapter (B647)', () => {
  it('B647: keeps the employer site and drops trudvsem contacts', () => {
    const vacancies = normalizeJsonSource(
      'src-trudvsem',
      {
        results: {
          vacancies: [
            {
              vacancy: {
                id: 'v1',
                company: { name: 'ПАО Россети Урал', inn: '6671163413', site: 'https://rosseti-ural.ru/career/', 'hr-agency': false },
                'job-name': 'Водитель',
                vac_url: 'https://trudvsem.ru/vacancy/card/c/v1',
                duty: 'Управление автомобилем',
                requirements: 'Права категории В',
                contact_list: [{ contact_type: 'Телефон', contact_value: '+7(342) 429-93-57' }],
                contact_person: 'Оленева Людмила Владимировна',
              },
            },
            {
              vacancy: {
                id: 'v2',
                company: { name: 'Кадровое агентство', site: 'https://agency.example/', 'hr-agency': true },
                'job-name': 'Продавец',
                vac_url: 'https://trudvsem.ru/vacancy/card/c/v2',
              },
            },
          ],
        },
      },
      { observedAt: OBSERVED_AT },
    );
    const [first, agency] = vacancies;
    expect(first?.employerSite).toBe('https://rosseti-ural.ru/career/');
    expect(first?.description).toContain('Права категории В');
    expect(JSON.stringify(first)).not.toContain('429-93-57');
    expect(JSON.stringify(first)).not.toContain('Оленева');
    expect(agency?.employerSite).toBeUndefined();
  });
});
