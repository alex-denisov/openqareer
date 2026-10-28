import { describe, expect, it } from 'vitest';
import {
  buildCandidateCompanyRows,
  buildConnectionCircles,
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
  it('a finished search that found nobody reads as done, not as never searched (28.10)', () => {
    const [row] = buildCandidateCompanyRows({
      vacancies: [vacancy('v1', 'Випсервис')],
      wants: [],
      recruiters: [],
      jobs: [{ vacancyId: 'v1', status: 'ready' }],
    });
    expect(row).toMatchObject({ recruiterSearchStatus: 'ready', hasRecruiter: false });
  });

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

describe('B448 connection circles', () => {
  it('ranks direct workplaces and mutual-contact paths with evidence, not estimates', () => {
    const result = buildConnectionCircles(
      connectionInput({
        candidateWorkplaces: [
          { companyName: 'Финтех Лаб', startDate: '2018-01', endDate: '2021-06' },
        ],
        recruiters: [
          {
            id: 'recruiter-1',
            fullName: 'Сергей Б.',
            roleTitle: 'Руководитель платежей',
            companyName: 'Вектор Банк',
            linkedinUrl: 'https://www.linkedin.com/in/sergey-b',
            workplaces: [{ companyName: 'Финтех Лаб', startDate: '2019-01', endDate: '2021-12' }],
          },
        ],
        contacts: [
          {
            id: 'contact-1',
            fullName: 'Анна Т.',
            roleTitle: 'Продакт-менеджер',
            companyName: 'Финтех Лаб',
            linkedinUrl: 'https://www.linkedin.com/in/anna-t',
            source: 'linkedin_import',
            relationship: 'Работали вместе',
            strength: 'strong',
            workplaces: [],
            knowsRecruiterIds: ['recruiter-1'],
          },
        ],
        linkedinContactsImported: true,
      }),
    );

    const direct = result.circles.find((circle) => circle.circle === 1)!;
    const mutual = result.circles.find((circle) => circle.circle === 2)!;
    const cold = result.circles.find((circle) => circle.circle === 3)!;
    expect(direct.paths[0]).toMatchObject({
      strength: 'strong',
      nextStep: 'write_known_contact',
      evidence: [expect.stringContaining('Финтех Лаб')],
    });
    expect(mutual.paths[0]).toMatchObject({
      strength: 'strong',
      nextStep: 'ask_for_introduction',
      path: [{ fullName: 'Андрей Лебедев' }, { fullName: 'Анна Т.' }, { fullName: 'Сергей Б.' }],
    });
    expect(cold.paths[0].nextStep).toBe('cold_application');
    expect(JSON.stringify(result)).not.toMatch(/probability|вероятност|процент/iu);
  });

  it('distinguishes unknown from an imported empty contact list', () => {
    const unknown = buildConnectionCircles(connectionInput({ linkedinContactsImported: false }));
    const emptyImport = buildConnectionCircles(connectionInput({ linkedinContactsImported: true }));

    expect(unknown.circles.find((circle) => circle.circle === 1)?.state).toBe('unknown');
    expect(unknown.circles.find((circle) => circle.circle === 2)?.state).toBe('unknown');
    expect(emptyImport.circles.find((circle) => circle.circle === 1)?.state).toBe('none');
    expect(emptyImport.circles.find((circle) => circle.circle === 2)?.state).toBe('none');
    expect(emptyImport.circles.find((circle) => circle.circle === 3)?.state).toBe('available');
    expect(emptyImport.circles.find((circle) => circle.circle === 3)?.paths[0]).toMatchObject({
      nextStep: 'cold_application',
      recipient: { id: 'vacancy:vacancy-1', fullName: 'Вектор Банк' },
    });
  });

  it('uses a manually added contact at the vacancy company as a direct path without LinkedIn import', () => {
    const result = buildConnectionCircles(
      connectionInput({
        contacts: [
          {
            id: 'manual-colleague',
            fullName: 'Елена Мельникова',
            roleTitle: 'Продакт-менеджер',
            companyName: 'Вектор Банк',
            linkedinUrl: null,
            source: 'manual',
            relationship: 'Работали вместе в одной команде',
            strength: 'unknown',
            workplaces: [],
            knowsRecruiterIds: [],
          },
        ],
        linkedinContactsImported: false,
      }),
    );
    const direct = result.circles.find((circle) => circle.circle === 1)!;

    expect(direct).toMatchObject({ state: 'available' });
    expect(direct.paths).toMatchObject([
      {
        recipient: { id: 'manual-colleague', fullName: 'Елена Мельникова' },
        strength: 'unknown',
        nextStep: 'write_known_contact',
        evidence: ['Работали вместе в одной команде'],
      },
    ]);
  });

  it('retains a weak path as weak and uses the prepare-only next step', () => {
    const result = buildConnectionCircles(
      connectionInput({
        recruiters: [
          {
            id: 'recruiter-2',
            fullName: 'Елена М.',
            roleTitle: 'HR-партнёр',
            companyName: 'Вектор Банк',
          },
        ],
        contacts: [
          {
            id: 'contact-weak',
            fullName: 'Павел Р.',
            roleTitle: 'Инженер',
            companyName: 'Другая компания',
            linkedinUrl: null,
            source: 'manual',
            relationship: 'Связь слабая: последний контакт в 2023',
            strength: 'weak',
            workplaces: [],
            knowsRecruiterIds: ['recruiter-2'],
          },
        ],
      }),
    );
    const mutual = result.circles.find((circle) => circle.circle === 2)!;

    expect(mutual.state).toBe('available');
    expect(mutual.paths[0]).toMatchObject({
      strength: 'weak',
      nextStep: 'ask_for_introduction',
    });
    expect(mutual.paths[0].evidence.join(' ')).toContain('слабая');
  });
});

function connectionInput(overrides: Record<string, unknown> = {}) {
  return {
    candidate: { id: 'candidate-1', fullName: 'Андрей Лебедев' },
    vacancy: { id: 'vacancy-1', companyName: 'Вектор Банк', title: 'Head of Platform' },
    candidateWorkplaces: [],
    recruiters: [],
    contacts: [],
    linkedinContactsImported: false,
    ...overrides,
  };
}
