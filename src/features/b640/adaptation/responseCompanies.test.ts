import { describe, expect, it } from 'vitest';
import { companySuggestions, dutiesFromVacancy, EXPECTATIONS_MAX, type ResponseLike } from './responseCompanies';

const response = (over: Partial<ResponseLike> & { company: string; title: string }): ResponseLike => ({
  clusterId: `c-${over.company}`,
  createdAt: '2026-11-01T10:00:00.000Z',
  appliedAt: null,
  stage: 'applied',
  offer: null,
  ...over,
  vacancy: { title: over.title, company: over.company, companyHidden: false },
});

describe('companySuggestions', () => {
  const list = [
    response({ company: 'Вектор Телеком', title: 'Технический директор', appliedAt: '2026-11-05T09:00:00.000Z' }),
    response({ company: 'Вектор Банк', title: 'Руководитель разработки', appliedAt: '2026-11-12T09:00:00.000Z' }),
    response({ company: 'Ладога', title: 'CTO', appliedAt: '2026-11-15T09:00:00.000Z' }),
  ];

  it('matches by part of the name from the second letter, newest response first', () => {
    expect(companySuggestions(list, 'В')).toEqual([]);
    expect(companySuggestions(list, 'вект').map((item) => [item.company, item.title, item.line])).toEqual([
      ['Вектор Банк', 'Руководитель разработки', 'Руководитель разработки · отклик 12.11'],
      ['Вектор Телеком', 'Технический директор', 'Технический директор · отклик 05.11'],
    ]);
  });

  it('puts a company with an offer first and says so', () => {
    const withOffer = [...list, response({ company: 'Вектор Строй', title: 'CIO', stage: 'offer', offer: { id: 'o' } })];
    const first = companySuggestions(withOffer, 'Вектор')[0];
    expect([first.company, first.line]).toEqual(['Вектор Строй', 'CIO · оффер']);
  });

  it('skips hidden companies, repeats and an exact match already typed', () => {
    const hidden = { ...response({ company: 'Вектор Банк', title: 'X' }), vacancy: { title: 'X', company: '', companyHidden: true } };
    const twice = [...list, response({ company: 'Вектор Банк', title: 'Руководитель разработки' }), hidden];
    expect(companySuggestions(twice, 'вектор').map((item) => item.company)).toEqual(['Вектор Банк', 'Вектор Телеком']);
    expect(companySuggestions(list, 'Ладога')).toEqual([]);
  });

  it('keeps at most five', () => {
    const many = Array.from({ length: 8 }, (_, index) => response({ company: `Альфа ${index}`, title: 'PM' }));
    expect(companySuggestions(many, 'Альфа')).toHaveLength(5);
  });
});

describe('dutiesFromVacancy', () => {
  it('takes the responsibilities the server already picked out', () => {
    expect(dutiesFromVacancy({ description: 'whatever', responsibilities: ['Руководить командой', 'Выстроить поставку'] })).toBe(
      'Руководить командой\nВыстроить поставку',
    );
  });

  it('otherwise takes the duties section of the text, without requirements and conditions', () => {
    const description = [
      'Банк ищет руководителя разработки.',
      'Задачи:',
      '• Руководить командой из 25 человек',
      '• Снизить число инцидентов',
      'Требования:',
      '• Опыт от 5 лет',
      'Условия:',
      '• ДМС',
    ].join('\n');
    expect(dutiesFromVacancy({ description, responsibilities: [] })).toBe(
      'Руководить командой из 25 человек\nСнизить число инцидентов',
    );
  });

  it('falls back to the start of the text, cut on a line', () => {
    const description = Array.from({ length: 200 }, (_, index) => `Строка ${index} про работу`).join('\n');
    const result = dutiesFromVacancy({ description, responsibilities: [] });
    expect(result.length).toBeLessThanOrEqual(EXPECTATIONS_MAX);
    expect(result.endsWith('про работу')).toBe(true);
  });

  it('gives an empty string when there is no text', () => {
    expect(dutiesFromVacancy({ description: '', responsibilities: [] })).toBe('');
  });
});
