import { describe, expect, it } from 'vitest';
import { vacancyConsultantPrompt } from './vacancyConsultantPrompt';

describe('vacancyConsultantPrompt (B549)', () => {
  it('asks why the company fits and names what to analyse', () => {
    expect(
      vacancyConsultantPrompt({
        canonicalTitle: 'Head of Engineering',
        canonicalCompany: 'Вектор Банк',
      }),
    ).toBe(
      'Почему «Вектор Банк» подходит? Разбери вакансию «Head of Engineering»: роль, уровень, гео, деньги, неподтверждённые требования и круг связей.',
    );
  });

  it('falls back to the vacancy when the company is unknown', () => {
    expect(vacancyConsultantPrompt({ canonicalTitle: 'CTO', canonicalCompany: '' })).toMatch(
      /^Почему эта вакансия подходит\? Разбери вакансию «CTO»/u,
    );
  });
});
