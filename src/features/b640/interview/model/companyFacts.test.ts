import { describe, expect, it } from 'vitest';
import { companyFacts, type CompanyFactsInput } from './companyFacts';

function company(over: Partial<CompanyFactsInput['company']> = {}): CompanyFactsInput['company'] {
  return {
    industry: 'Логистика',
    location: 'Москва',
    sources: [
      { name: 'hh.ru', observedAt: '2026-11-04T10:00:00Z' },
      { name: 'Хабр Карьера', observedAt: '2026-11-08T10:00:00Z' },
    ],
    recruiters: [
      { vacancyId: 'cl-1', fullName: 'Сергей Минин', roleTitle: 'технический директор' },
      { vacancyId: 'cl-2', fullName: 'Анна Ли', roleTitle: 'рекрутер' },
    ],
    ...over,
  };
}

describe('companyFacts', () => {
  it('shows only stored facts: what the company does and who hires for this vacancy', () => {
    const facts = companyFacts({ company: company(), clusterId: 'cl-1' });
    expect(facts.rows).toEqual([
      { label: 'Чем занята', value: 'Логистика, Москва' },
      { label: 'Кто ведёт', value: 'Сергей Минин, технический директор' },
    ]);
    expect(facts.source).toBe('Из карточки компании на платформе: hh.ru, Хабр Карьера, 8 ноября.');
  });

  it('never names a recruiter of another vacancy as the one who hires', () => {
    const facts = companyFacts({ company: company(), clusterId: 'cl-9' });
    expect(facts.rows.map((row) => row.label)).toEqual(['Чем занята']);
  });

  it('has no rows and no news row when the platform knows nothing', () => {
    const facts = companyFacts({
      company: company({ industry: null, location: null, recruiters: [], sources: [] }),
      clusterId: 'cl-1',
    });
    expect(facts.rows).toEqual([]);
    expect(facts.source).toBeNull();
  });

  it('B749: вне подборки берёт вакансию, сохранённую в отклике', () => {
    const vacancy = {
      title: 'Инженер',
      company: 'Арка',
      url: 'https://x',
      source: 'hh',
      description: 'Ищем инженера. Арка строит платформу для логистики. Ждём вас.',
    };
    const savedAt = '2026-11-04T10:00:00Z';
    expect(
      companyFacts({ company: null, clusterId: null, snapshot: { vacancy, savedAt } }),
    ).toEqual({
      rows: [
        { label: 'Компания', value: 'Арка' },
        { label: 'В вакансии', value: 'Арка строит платформу для логистики.' },
      ],
      source: 'Из вакансии, сохранённой в отклике 4 ноября.',
    });
    const hidden = { ...vacancy, companyHidden: true };
    expect(
      companyFacts({ company: null, clusterId: null, snapshot: { vacancy: hidden, savedAt } }).rows,
    ).toEqual([]);
  });

  it('is empty for a response without a company card', () => {
    expect(companyFacts({ company: null, clusterId: null }).rows).toEqual([]);
  });
});
