import { describe, expect, it } from 'vitest';
import { buildCandidateCompanyRows } from './candidateCompanies';
import {
  countWantStages,
  filterWantRows,
  wantIndustries,
  wantedCompanyRows,
} from './candidateCompanyWantList';

const NOW = Date.parse('2026-11-02T12:00:00Z');

function vacancy(id: string, companyName: string, sourceDate: string, industry = 'Финтех') {
  return {
    id,
    companyName,
    location: null,
    industry,
    sourceName: 'hh.ru',
    sourceDate,
    href: '',
    title: 'VP',
  };
}

function rows() {
  return buildCandidateCompanyRows({
    now: NOW,
    vacancies: [
      vacancy('v1', 'Нордлайн', '2026-11-01T00:00:00Z'),
      vacancy('v2', 'Сфера', '2026-10-01T00:00:00Z', 'Платежи'),
      vacancy('v3', 'Чужая', '2026-11-01T00:00:00Z'),
    ],
    wants: [
      {
        companyKey: 'a',
        companyName: 'Нордлайн',
        nextStep: null,
        nextStepDueAt: null,
        createdAt: '2026-10-01',
      },
      {
        companyKey: 'b',
        companyName: 'Сфера',
        nextStep: null,
        nextStepDueAt: null,
        stage: 'path',
        createdAt: '2026-10-03',
      },
      {
        companyKey: 'c',
        companyName: 'Бета',
        nextStep: null,
        nextStepDueAt: null,
        createdAt: '2026-10-02',
      },
    ],
    recruiters: [],
    jobs: [],
  });
}

describe('«Хочу в компанию» list', () => {
  it('counts only wanted companies, not every company of the vacancy selection', () => {
    const wanted = wantedCompanyRows(rows());
    expect(countWantStages(wanted)).toEqual({ all: 3, new: 1, want: 1, path: 1, waiting: 1 });
  });

  it('derives waiting for a company without vacancies and keeps a manual stage', () => {
    const byName = Object.fromEntries(
      wantedCompanyRows(rows()).map((row) => [row.name, row.wantStage]),
    );
    expect(byName).toEqual({ Нордлайн: 'want', Сфера: 'path', Бета: 'waiting' });
  });

  it('filters by stage, industry and search, and sorts by date added', () => {
    const wanted = wantedCompanyRows(rows());
    const base = {
      stage: 'all',
      search: '',
      industry: '',
      contacts: 'any',
      sort: 'vacancies',
    } as const;
    expect(filterWantRows(wanted, { ...base, stage: 'new' }).map((row) => row.name)).toEqual([
      'Нордлайн',
    ]);
    expect(filterWantRows(wanted, { ...base, industry: 'Платежи' }).map((row) => row.name)).toEqual(
      ['Сфера'],
    );
    expect(filterWantRows(wanted, { ...base, search: 'плат' }).map((row) => row.name)).toEqual([
      'Сфера',
    ]);
    expect(filterWantRows(wanted, { ...base, sort: 'added' }).map((row) => row.name)).toEqual([
      'Сфера',
      'Бета',
      'Нордлайн',
    ]);
    expect(wantIndustries(wanted)).toEqual(['Платежи', 'Финтех']);
  });
});
