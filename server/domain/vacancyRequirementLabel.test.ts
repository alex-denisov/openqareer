import { describe, expect, it } from 'vitest';
import type { VacancyRequirement } from './vacancyRequirements';
import { labelVacancyRequirement } from './vacancyRequirementLabel';

function requirement(text: string, kind: VacancyRequirement['kind'] = 'other', minYears?: number): VacancyRequirement {
  return { id: 'r', text, sourceQuote: text, origin: 'structural', importance: 'high', kind, hard: false, stopFactor: false, ...(minYears ? { minYears } : {}) };
}

describe('labelVacancyRequirement (B510)', () => {
  it('names the known skill of a long requirement and marks it quiz material', () => {
    expect(labelVacancyRequirement(requirement('Strong SQL, dbt, and Python, and you still write production code'))).toMatchObject({ label: 'Python', skill: true });
  });

  it('gives a long sentence without a known skill no label, so it never becomes a chip', () => {
    const long = requirement('Proven track record as a senior engineering leader - you have owned technical direction for several teams', 'experience');
    expect(labelVacancyRequirement(long).label).toBeUndefined();
    expect(labelVacancyRequirement(long).skill).toBe(false);
  });

  it('keeps a short requirement as its own name without the trailing dot', () => {
    expect(labelVacancyRequirement(requirement('Playwright.'))).toMatchObject({ label: 'Playwright', skill: true });
  });

  it('names conditions in Russian and keeps them out of the quiz', () => {
    expect(labelVacancyRequirement(requirement('15+ years of software engineering experience, with at least 5 years in management', 'experience', 15))).toMatchObject({ label: 'Опыт от 15 лет', skill: false });
    expect(labelVacancyRequirement(requirement('Fluent English at C1 level or higher for daily work with clients', 'language'))).toMatchObject({ label: 'Английский C1', skill: false });
    expect(labelVacancyRequirement(requirement('The ability to explain what data means in plain language to leaders', 'language')).label).toBeUndefined();
  });

  it('keeps the full text for the explanation', () => {
    const text = 'Strong SQL, dbt, and Python, and you still write production code';
    expect(labelVacancyRequirement(requirement(text))).toMatchObject({ text, sourceQuote: text });
  });
});
