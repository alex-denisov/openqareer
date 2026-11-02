import type {
  CandidateCompanyContactsFilter,
  CandidateCompanyOpportunity,
  CandidateCompanyWantCounts,
  CandidateCompanyWantSelectionItem,
  CandidateCompanyWantSort,
  CandidateCompanyWantStage,
  CandidateCompanyWantStageFilter,
} from '../../shared/candidateCompany';

export interface CandidateCompanyWantQuery {
  readonly stage: CandidateCompanyWantStageFilter;
  readonly search: string;
  readonly industry: string;
  readonly contacts: CandidateCompanyContactsFilter;
  readonly sort: CandidateCompanyWantSort;
}

function stageOf(row: CandidateCompanyOpportunity): CandidateCompanyWantStage {
  return row.wantStage ?? 'want';
}

function matchesStage(row: CandidateCompanyOpportunity, stage: CandidateCompanyWantStageFilter) {
  if (stage === 'all') return true;
  if (stage === 'new') return row.hasNewVacancies === true;
  return stageOf(row) === stage;
}

function matchesContacts(
  row: CandidateCompanyOpportunity,
  contacts: CandidateCompanyContactsFilter,
) {
  if (contacts === 'with') return (row.contactsCount ?? 0) > 0;
  if (contacts === 'without') return !row.contactsCount;
  return true;
}

function matchesSearch(row: CandidateCompanyOpportunity, query: string) {
  if (!query) return true;
  return [row.name, row.industry ?? ''].some((value) =>
    value.toLocaleLowerCase('ru-RU').includes(query),
  );
}

export function wantedCompanyRows(
  rows: readonly CandidateCompanyOpportunity[],
): CandidateCompanyOpportunity[] {
  return rows.filter((row) => row.want);
}

export function countWantStages(
  rows: readonly CandidateCompanyOpportunity[],
): CandidateCompanyWantCounts {
  return {
    all: rows.length,
    new: rows.filter((row) => row.hasNewVacancies).length,
    want: rows.filter((row) => stageOf(row) === 'want').length,
    path: rows.filter((row) => stageOf(row) === 'path').length,
    waiting: rows.filter((row) => stageOf(row) === 'waiting').length,
  };
}

export function wantIndustries(rows: readonly CandidateCompanyOpportunity[]): string[] {
  const values = new Set(rows.flatMap((row) => (row.industry ? [row.industry] : [])));
  return [...values].sort((a, b) => a.localeCompare(b, 'ru'));
}

export function filterWantRows(
  rows: readonly CandidateCompanyOpportunity[],
  query: CandidateCompanyWantQuery,
): CandidateCompanyOpportunity[] {
  const search = query.search.trim().toLocaleLowerCase('ru-RU');
  const filtered = rows.filter(
    (row) =>
      matchesStage(row, query.stage) &&
      matchesContacts(row, query.contacts) &&
      (!query.industry || row.industry === query.industry) &&
      matchesSearch(row, search),
  );
  return sortWantRows(filtered, query.sort);
}

function sortWantRows(
  rows: readonly CandidateCompanyOpportunity[],
  sort: CandidateCompanyWantSort,
): CandidateCompanyOpportunity[] {
  const byName = (a: CandidateCompanyOpportunity, b: CandidateCompanyOpportunity) =>
    a.name.localeCompare(b.name, 'ru') || a.key.localeCompare(b.key);
  if (sort === 'alphabetical') return [...rows].sort(byName);
  if (sort === 'added') {
    return [...rows].sort(
      (a, b) => (b.wantedAt ?? '').localeCompare(a.wantedAt ?? '') || byName(a, b),
    );
  }
  return [...rows].sort((a, b) => b.vacancyCount - a.vacancyCount || byName(a, b));
}

export function toWantSelectionItem(
  row: CandidateCompanyOpportunity,
): CandidateCompanyWantSelectionItem {
  return {
    key: row.key,
    name: row.name,
    industry: row.industry,
    stage: stageOf(row),
    vacancyCount: row.vacancyCount,
    contactsCount: row.contactsCount,
    nextStep: row.nextStep?.text ?? null,
  };
}
