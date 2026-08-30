import { describe, expect, it } from 'vitest';
import { rankVacanciesByQuery } from './vacancyRelevance';

/**
 * B161 review §4 — the old ranker matched unanchored substrings, so `go` hit
 * *Django*, *Google* and *Algolia*, and `qa` hit *Aqua Security*. A six-word
 * query passed anything that matched one word in `location`.
 */
function vacancy(title: string, company = 'Acme', location = 'Remote', requirements: string[] = []) {
  return { title, company, location, requirements };
}

describe('vacancy relevance ranking', () => {
  it('does not match a term inside a longer word', () => {
    const items = [vacancy('Django Developer'), vacancy('Frontend Engineer', 'Google')];

    expect(rankVacanciesByQuery(items, 'go')).toEqual([]);
  });

  it('still matches the same term when it stands on its own', () => {
    const items = [vacancy('Go Backend Engineer'), vacancy('Django Developer')];

    expect(rankVacanciesByQuery(items, 'go').map((item) => item.title)).toEqual([
      'Go Backend Engineer',
    ]);
  });

  it('requires a real share of a long query to match, not one stray word', () => {
    const items = [
      vacancy('Chef de Cuisine', 'Bistro', 'Berlin, Remote'),
      vacancy('Senior Product Manager Fintech Remote Berlin', 'Fintech Co', 'Berlin'),
    ];

    const ranked = rankVacanciesByQuery(items, 'senior product manager fintech remote berlin');

    expect(ranked.map((item) => item.title)).toEqual([
      'Senior Product Manager Fintech Remote Berlin',
    ]);
  });

  it('ranks a title match above the same word appearing only in the company', () => {
    const items = [
      vacancy('Frontend Engineer', 'Python Software Foundation'),
      vacancy('Python Engineer', 'Acme'),
    ];

    expect(rankVacanciesByQuery(items, 'python').map((item) => item.company)).toEqual([
      'Acme',
      'Python Software Foundation',
    ]);
  });

  it('keeps terms that are themselves short but exact', () => {
    const items = [vacancy('QA Automation Engineer'), vacancy('Engineer', 'Aqua Security')];

    expect(rankVacanciesByQuery(items, 'qa').map((item) => item.title)).toEqual([
      'QA Automation Engineer',
    ]);
  });

  it('treats a query with no usable term as no relevance signal', () => {
    expect(rankVacanciesByQuery([vacancy('Engineer')], '   ')).toEqual([]);
  });

  it('matches terms carrying + and # as written', () => {
    const items = [vacancy('C++ Developer'), vacancy('C# Developer')];

    expect(rankVacanciesByQuery(items, 'c++').map((item) => item.title)).toEqual(['C++ Developer']);
  });
});
