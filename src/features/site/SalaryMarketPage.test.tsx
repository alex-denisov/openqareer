// @vitest-environment jsdom
import React from 'react';
import { selectSalaryGrade, selectSalaryLocation } from '../../../shared/salaryMarketPublic';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SalaryMarketPage, salarySnapshotIndexable, salaryRolePath } from './SalaryMarketPage';
import type { SalaryMarketSnapshot } from '../../../shared/salaryMarketSnapshot';
export const TEST_SALARY_SNAPSHOT: SalaryMarketSnapshot = {
  role: 'software-engineer',
  profession: { kind: 'b267', roleId: 'eng.frontend.ic' },
  roleLabel: 'Software Engineer',
  updatedAt: '2026-10-23T00:00:00Z',
  windowDays: 90,
  sampleSize: 20,
  source: 'deduplicated_public_catalog',
  skills: [{ name: 'TypeScript', count: 10, frequency: 50 }],
  grades: 'unavailable',
  quarterlyTrend: 'unavailable',
  salary: {
    status: 'available',
    methodology: 'published_range_bounds',
    excluded: {
      missingPeriod: 10,
      missingCurrency: 0,
      openRange: 0,
      invalidRange: 0,
      belowMinimumSample: 0,
    },
    groups: [
      {
        currency: 'EUR',
        period: 'year',
        taxBasis: 'gross',
        sampleSize: 10,
        lower: { p25: 50000, p50: 60000, p75: 70000, p90: 80000 },
        upper: { p25: 70000, p50: 80000, p75: 90000, p90: 100000 },
      },
      {
        currency: 'USD',
        period: 'hour',
        taxBasis: 'unknown',
        sampleSize: 5,
        lower: { p25: 30, p50: 40, p75: 50, p90: 60 },
        upper: { p25: 40, p50: 50, p75: 60, p90: 70 },
      },
    ],
  },
};
describe('public salary evidence page', () => {
  it('shows explicit pay period, separate bounds and skill denominator', () => {
    const html = renderToStaticMarkup(<SalaryMarketPage snapshot={TEST_SALARY_SNAPSHOT} />);
    expect(html).toContain('Software Engineer');
    expect(html).toContain('EUR, в год, до налогов');
    expect(html).toContain('10 из 20');
    expect(html).toContain('href="/salaries/software-engineer?group=1"');
    expect(html).toContain('href="/signup"');
    expect(html).toContain('Сравните навыки');
    expect(html).toContain('ym-hide-content');
    expect(html).toContain('ym-disable-keys');
    expect(html).not.toContain('name="skills"');
    expect(html).toContain('Individual contributor не означает junior');
  });
  it('selects only a supported bucket and names its own sample', () => {
    const html = renderToStaticMarkup(
      <SalaryMarketPage snapshot={TEST_SALARY_SNAPSHOT} selectedGroup={1} />,
    );
    expect(html).toContain('id="salary-distribution-title">USD, в час, налоги не указаны');
    expect(html).toContain('5 вакансий с полной вилкой');
  });
  it('does not invent a barometer without an observation', () => {
    const html = renderToStaticMarkup(<SalaryMarketPage snapshot={null} />);
    expect(html).toContain('Сравнимой зарплатной выборки пока нет');
    expect(html).not.toContain('<dt>P50</dt>');
    expect(salarySnapshotIndexable(null)).toBe(false);
    expect(salaryRolePath('../private')).toBeUndefined();
  });
});

describe('prepared profession and grade views', () => {
  const graded: SalaryMarketSnapshot = {
    ...TEST_SALARY_SNAPSHOT,
    profession: { kind: 'b267', roleId: 'eng.software-engineer' },
    grades: 'published_title_evidence',
    gradeSlices: [
      {
        grade: 'senior',
        sampleSize: 8,
        skills: [{ name: 'SQL', count: 2, frequency: 25 }],
        salary:
          TEST_SALARY_SNAPSHOT.salary.status === 'available'
            ? {
                ...TEST_SALARY_SNAPSHOT.salary,
                groups: TEST_SALARY_SNAPSHOT.salary.groups.map((group) => ({
                  ...group,
                  sampleSize: 5,
                })),
                excluded: {
                  missingPeriod: 3,
                  missingCurrency: 0,
                  openRange: 0,
                  invalidRange: 0,
                  belowMinimumSample: 0,
                },
              }
            : TEST_SALARY_SNAPSHOT.salary,
        evidence: { field: 'title', markers: ['Senior'] },
      },
      {
        grade: 'unknown',
        sampleSize: 2,
        skills: [],
        salary: {
          status: 'unavailable',
          reason: 'no_comparable_ranges',
          excluded: {
            missingPeriod: 2,
            missingCurrency: 0,
            openRange: 0,
            invalidRange: 0,
            belowMinimumSample: 0,
          },
        },
        evidence: { field: 'title', markers: [] },
      },
    ],
  };
  it('uses the selected grade denominator and preserves it in the salary bucket link', () => {
    const html = renderToStaticMarkup(<SalaryMarketPage snapshot={graded} grade="senior" />);
    expect(html).toContain('Senior (8)');
    expect(html).toContain('2 из 8');
    expect(html).not.toContain('10 из 20');
    expect(html).toContain('grade=senior&amp;group=0');
    expect(html).toContain('Примеры маркеров: Senior');
    expect(html).toContain('Профессия — по классификатору');
  });
  it('never labels the unknown slice Junior or fills its missing salary from all grades', () => {
    const html = renderToStaticMarkup(<SalaryMarketPage snapshot={graded} grade="unknown" />);
    expect(html).toContain('Грейд не подтверждён (2)');
    expect(html).not.toContain('<dt>P50</dt>');
    expect(html).not.toContain('Примеры маркеров:');
  });
  it('keeps unclassified raw titles outside the indexed profession barometer', () => {
    expect(
      salarySnapshotIndexable({
        ...TEST_SALARY_SNAPSHOT,
        profession: { kind: 'unclassified_title' },
      }),
    ).toBe(false);
  });
  it('paginates the actual top-15 skills while preserving grade and currency group', () => {
    const source: SalaryMarketSnapshot = {
      ...graded,
      gradeSlices: graded.gradeSlices?.map((slice) => ({
        ...slice,
        skills: Array.from({ length: 15 }, (_, i) => ({
          name: `Technology ${i}`,
          count: 2,
          frequency: 25,
        })),
      })),
    };
    const first = renderToStaticMarkup(<SalaryMarketPage snapshot={source} grade="senior" />);
    expect((first.match(/<meter /gu) ?? []).length).toBe(5);
    expect(first).toContain('grade=senior&amp;group=0&amp;skills=2');
    const second = renderToStaticMarkup(
      <SalaryMarketPage snapshot={source} grade="senior" skillsPage={2} />,
    );
    expect(second).toContain('start="6"');
    expect(second).toContain('Technology 5');
    expect(second).not.toContain('Technology 0<');
  });
});

describe('actual saved skill frequency history', () => {
  const history = {
    status: 'available' as const,
    method: 'observed_catalog_skill_frequency_pp' as const,
    methodVersion: 'test-v1',
    earliestActualObservation: '2026-07-24T00:00:00Z',
    current: { observedAt: TEST_SALARY_SNAPSHOT.updatedAt, sampleSize: 20 },
    baseline: { observedAt: '2026-07-24T00:00:00Z', sampleSize: 25 },
    skills: [
      {
        name: 'TypeScript',
        currentCount: 10,
        currentFrequency: 50,
        baselineCount: 5,
        baselineFrequency: 20,
        changePP: 30,
        status: 'available' as const,
      },
    ],
  };
  it('renders observed percentage-point changes with both dated denominators', () => {
    const html = renderToStaticMarkup(
      <SalaryMarketPage snapshot={{ ...TEST_SALARY_SNAPSHOT, skillQuarterlyTrend: history }} />,
    );
    expect(html).toContain('+30 п.п.');
    expect(html).toContain('было 20%');
    expect(html).toContain('24.07.2026');
    expect(html).toContain('25 вакансий');
    expect(html).toContain('20 вакансий');
    expect(html).toContain('а не всего рынка');
  });
  it('does not turn a skill missing from the saved top-15 into zero', () => {
    const absent = {
      ...history,
      skills: [
        {
          name: 'TypeScript',
          currentCount: 10,
          currentFrequency: 50,
          baselineCount: null,
          baselineFrequency: null,
          changePP: null,
          status: 'baseline_skill_unavailable' as const,
        },
      ],
    };
    const html = renderToStaticMarkup(
      <SalaryMarketPage snapshot={{ ...TEST_SALARY_SNAPSHOT, skillQuarterlyTrend: absent }} />,
    );
    expect(html).toContain('нет сравнения');
    expect(html).not.toContain('было 0%');
    const graded: SalaryMarketSnapshot = {
      ...TEST_SALARY_SNAPSHOT,
      gradeSlices: [
        {
          grade: 'senior',
          sampleSize: 20,
          skills: TEST_SALARY_SNAPSHOT.skills,
          salary: TEST_SALARY_SNAPSHOT.salary,
          evidence: { field: 'title', markers: ['Senior'] },
          skillQuarterlyTrend: absent,
        },
      ],
    };
    expect(selectSalaryGrade(graded, 'senior')?.quarterlyTrend).toBe('unavailable');
  });
  it('uses only the selected grade history and explains the real first observation', () => {
    const first = {
      status: 'insufficient_history' as const,
      method: history.method,
      methodVersion: history.methodVersion,
      earliestActualObservation: TEST_SALARY_SNAPSHOT.updatedAt,
      current: { observedAt: TEST_SALARY_SNAPSHOT.updatedAt, sampleSize: 8 },
    };
    const source: SalaryMarketSnapshot = {
      ...TEST_SALARY_SNAPSHOT,
      skillQuarterlyTrend: history,
      gradeSlices: [
        {
          grade: 'senior',
          sampleSize: 8,
          skills: TEST_SALARY_SNAPSHOT.skills,
          salary: TEST_SALARY_SNAPSHOT.salary,
          evidence: { field: 'title', markers: ['Senior'] },
          skillQuarterlyTrend: first,
        },
      ],
    };
    const html = renderToStaticMarkup(<SalaryMarketPage snapshot={source} grade="senior" />);
    expect(html).toContain('Первое фактическое наблюдение: 23.10.2026');
    expect(html).toContain('Без истории изменение неизвестно');
    expect(html).not.toContain('24.07.2026');
    expect(html).not.toContain('+30 п.п.');
  });
});

it('uses the selected region before its grade and preserves the region in navigation', () => {
  const snapshot: SalaryMarketSnapshot = {
    ...TEST_SALARY_SNAPSHOT,
    geography: {
      method: 'explicit_source_country_v1',
      regionPolicy: 'openqareer_candidate_regions_v1',
      explicitCountryCount: 12,
      unknownCountryCount: 8,
      ambiguousCountryCount: 0,
      remoteCount: 10,
    },
    locationSlices: [
      {
        location: 'europe',
        evidenceMethod: 'explicit_source_country_v1',
        sampleSize: 10,
        salary: TEST_SALARY_SNAPSHOT.salary,
        skills: [{ name: 'Regional SQL', count: 7, frequency: 70 }],
        quarterlyTrend: 'unavailable',
        gradeSlices: [
          {
            grade: 'senior',
            sampleSize: 5,
            skills: [{ name: 'Regional Senior', count: 2, frequency: 40 }],
            salary: TEST_SALARY_SNAPSHOT.salary,
            evidence: { field: 'title', markers: ['Senior'] },
          },
        ],
      },
    ],
  };
  const html = renderToStaticMarkup(
    <SalaryMarketPage snapshot={snapshot} location="europe" grade="senior" />,
  );
  expect(html).toContain('5 вакансий ·');
  expect(html).toContain('2 из 5');
  expect(html).toContain('Regional Senior');
  expect(html).not.toContain('Regional SQL');
  expect(html).toContain('data-location="europe"');
  expect(html).toContain('name="grade" value="senior"');
  expect(html).toContain('grade=senior&amp;location=europe&amp;group=1');
  expect(html).toContain('не даёт права работать из любой страны');
  const legacy = renderToStaticMarkup(<SalaryMarketPage snapshot={TEST_SALARY_SNAPSHOT} />);
  expect(legacy).toContain('Географические срезы ещё не подготовлены');
  expect(legacy).not.toContain('id="salary-location"');
});

it('annotates label categories without changing rank, frequency or denominator', () => {
  const skills = [
    { name: 'SQL', count: 10, frequency: 50 },
    { name: 'People Management', count: 8, frequency: 40 },
    { name: 'C++', count: 6, frequency: 30 },
    { name: 'Communication', count: 2, frequency: 10 },
  ];
  const html = renderToStaticMarkup(
    <SalaryMarketPage snapshot={{ ...TEST_SALARY_SNAPSHOT, skills }} />,
  );
  const document = new DOMParser().parseFromString(html, 'text/html');
  const rows = [...document.querySelectorAll('.sm-skill-list li')];
  expect(rows.map((row) => row.querySelector('span')?.firstChild?.textContent)).toEqual(
    skills.map((row) => row.name),
  );
  expect(rows.map((row) => row.querySelector('span:first-child small')?.textContent)).toEqual([
    'Технический',
    'Профильный',
    'Не определена',
    'Не определена',
  ]);
  expect(rows.map((row) => row.querySelector('meter')?.getAttribute('value'))).toEqual([
    '50',
    '40',
    '30',
    '10',
  ]);
  expect(rows.map((row) => row.querySelector('span:nth-child(2) small')?.textContent)).toEqual([
    '10 из 20',
    '8 из 20',
    '6 из 20',
    '2 из 20',
  ]);
  expect(html).toContain('data-skill-classification="b265_skill_categories_v1"');
  expect(html).toContain('Не оцениваем важность и владение');
  expect(skills).toEqual([
    { name: 'SQL', count: 10, frequency: 50 },
    { name: 'People Management', count: 8, frequency: 40 },
    { name: 'C++', count: 6, frequency: 30 },
    { name: 'Communication', count: 2, frequency: 10 },
  ]);
});

it('shows the selected cohort withholding evidence and the limits of absent labels', () => {
  const source = {
    ...TEST_SALARY_SNAPSHOT,
    skillEvidence: {
      method: 'exclude_role_taxonomy_clusters_v2' as const,
      withheldClusterCount: 7,
    },
  };
  const html = renderToStaticMarkup(<SalaryMarketPage snapshot={source} />);
  expect(html).toContain('Карточек со скрытыми навыками: 7');
  expect(html).toContain('категории должностей');
  expect(html).toContain('Частоту считаем от всех карточек, в том числе без навыков');
  expect(html).toContain('Нет в срезе — не значит нет в вакансии');
});

it('selects withholding counts from the region and then grade without borrowing global evidence', () => {
  const skillEvidence = (withheldClusterCount: number) => ({
    method: 'exclude_role_taxonomy_clusters_v2' as const,
    withheldClusterCount,
  });
  const source: SalaryMarketSnapshot = {
    ...TEST_SALARY_SNAPSHOT,
    skillEvidence: skillEvidence(7),
    locationSlices: [
      {
        location: 'remote',
        evidenceMethod: 'stored_remote_flag_v1',
        sampleSize: 10,
        skills: [],
        salary: TEST_SALARY_SNAPSHOT.salary,
        skillEvidence: skillEvidence(2),
        quarterlyTrend: 'unavailable',
        gradeSlices: [
          {
            grade: 'senior',
            sampleSize: 5,
            skills: [],
            salary: TEST_SALARY_SNAPSHOT.salary,
            evidence: { field: 'title', markers: ['Senior'] },
            skillEvidence: skillEvidence(1),
          },
        ],
      },
    ],
  };
  const regional = selectSalaryLocation(source, 'remote');
  expect(regional?.skillEvidence?.withheldClusterCount).toBe(2);
  const selected = selectSalaryGrade(regional, 'senior');
  expect(selected?.skillEvidence?.withheldClusterCount).toBe(1);
  const html = renderToStaticMarkup(
    <SalaryMarketPage snapshot={source} location="remote" grade="senior" />,
  );
  expect(html).toContain('Карточек со скрытыми навыками: 1');
  expect(html).not.toContain('Карточек со скрытыми навыками: 7');
});
