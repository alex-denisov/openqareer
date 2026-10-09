import { describe, expect, it } from 'vitest';
import {
  buildCandidateCompanyRows,
  candidateCompanyKey,
  filterCandidateCompanyRows,
  sortCandidateCompanyRows,
} from './candidateCompanies';
import type { CandidateCompanyVacancyInput } from './candidateCompanies';

function vacancy(
  id: string,
  companyName: string,
  sourceName = 'hh.ru',
): CandidateCompanyVacancyInput {
  return {
    id,
    companyName,
    location: 'Москва, гибрид',
    industry: 'Финансы',
    title: 'Руководитель платформы',
    sourceName,
    sourceDate: '2026-10-08T10:00:00.000Z',
    href: `https://hh.ru/vacancy/${id}`,
  };
}

describe('B439 candidate company projection', () => {
  it('unions matched companies with wanted companies that have no matched vacancy', () => {
    const wantedKey = candidateCompanyKey('Арка Холдинг');
    const rows = buildCandidateCompanyRows({
      vacancies: [vacancy('v1', 'Вектор Банк'), vacancy('v2', 'Вектор Банк')],
      wants: [
        { companyKey: wantedKey, companyName: 'Арка Холдинг', nextStep: null, nextStepDueAt: null },
      ],
      recruiters: [],
      jobs: [],
    });

    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.name === 'Вектор Банк')?.vacancyCount).toBe(2);
    expect(rows.find((row) => row.name === 'Арка Холдинг')).toMatchObject({
      vacancyCount: 0,
      want: true,
      contactsCount: null,
    });
  });

  it('does not turn missing LinkedIn contact imports into zero contacts', () => {
    const [row] = buildCandidateCompanyRows({
      vacancies: [vacancy('v1', 'Вектор Банк')],
      wants: [],
      recruiters: [],
      jobs: [],
    });

    expect(row?.contactsCount).toBeNull();
  });

  it('sorts by wants, vacancy count, contacts, and name in the default order', () => {
    const rows = buildCandidateCompanyRows({
      vacancies: [
        vacancy('v1', 'Бета'),
        vacancy('v2', 'Бета'),
        vacancy('v3', 'Альфа'),
        vacancy('v4', 'Дельта'),
      ],
      wants: [
        {
          companyKey: candidateCompanyKey('Дельта'),
          companyName: 'Дельта',
          nextStep: null,
          nextStepDueAt: null,
        },
      ],
      recruiters: [],
      jobs: [],
      networkContactCounts: new Map([
        [candidateCompanyKey('Альфа'), { count: 8, importedAt: '2026-10-08' }],
        [candidateCompanyKey('Бета'), { count: 2, importedAt: '2026-10-08' }],
      ]),
    });

    expect(sortCandidateCompanyRows(rows, 'default').map((row) => row.name)).toEqual([
      'Дельта',
      'Бета',
      'Альфа',
    ]);
  });

  it('filters only known positive contact counts and recruiters', () => {
    const rows = buildCandidateCompanyRows({
      vacancies: [vacancy('v1', 'Альфа'), vacancy('v2', 'Бета')],
      wants: [],
      recruiters: [
        {
          id: 'recruiter-1',
          companyKey: candidateCompanyKey('Бета'),
          vacancyId: 'v2',
          fullName: 'Анна Седова',
          roleTitle: 'Рекрутер',
          email: null,
          emailStatus: 'unverified',
          phone: null,
          telegram: null,
          whatsapp: null,
          linkedinUrl: null,
          githubUrl: null,
          twitterUrl: null,
          source: 'vacancy',
          sourceLabel: 'Объявление вакансии',
          sourceDate: '2026-10-08',
          isHypothesis: false,
        },
      ],
      jobs: [],
      networkContactCounts: new Map([
        [candidateCompanyKey('Альфа'), { count: 1, importedAt: '2026-10-08' }],
      ]),
    });

    expect(filterCandidateCompanyRows(rows, 'contacts').map((row) => row.name)).toEqual(['Альфа']);
    expect(filterCandidateCompanyRows(rows, 'recruiter').map((row) => row.name)).toEqual(['Бета']);
  });
});
