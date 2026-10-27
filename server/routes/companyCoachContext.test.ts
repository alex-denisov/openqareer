import { describe, expect, it } from 'vitest';
import { companyCoachContextText } from './companyCoachContext';

describe('companyCoachContextText (макет 13, 28.10)', () => {
  it('names the section, the company, its selection vacancies and people', () => {
    const text = companyCoachContextText(
      { name: 'Autodesk', vacancyCount: 2, contactsCount: 1, want: true },
      [{ title: 'Senior Director, Engineering' }, { title: 'VP Platform' }],
    );
    expect(text).toBe(
      [
        'Раздел: Компании и люди',
        'Компания: Autodesk («Хочу в эту компанию»)',
        'Вакансий в подборке: 2 — Senior Director, Engineering; VP Platform',
        'Контактов в сети: 1',
      ].join('\n'),
    );
  });

  it('says the network is unknown before a contact import', () => {
    const text = companyCoachContextText(
      { name: 'VK', vacancyCount: 0, contactsCount: null, want: false },
      [],
    );
    expect(text).toContain('Вакансий в подборке: 0');
    expect(text).toContain('Контакты в сети: неизвестно');
  });
});
