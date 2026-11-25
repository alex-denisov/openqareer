import type { FastifyRequest } from 'fastify';
import type { VacancySort } from '../../shared/vacancySort';
import type { MatchedVacancyFilters } from '../vacancies/matchedVacancyFilters';
import type { MatchedVacancyItem } from '../vacancies/multiSourceVacancyEngine';
import type { B640ListContext } from './b640VacancyContext';
import type { RouteDeps } from './deps';
import { rebuildBehindSealedList } from './matchedListWarm';
import { matchedOrderChoiceKeys } from './matchedVacancyFit';
import { readSealedMatchedList } from './matchedVacancyList';
import type { SealedMatchedList } from './sealedMatchedList';

/** Строки запечатанного списка подряд с нуля: страница с разрывом дальше не читается. */
export function sealedPrefix(sealed: SealedMatchedList): readonly MatchedVacancyItem[] {
  const rows: MatchedVacancyItem[] = [];
  for (const page of [...sealed.pages].sort((a, b) => a.offset - b.offset)) {
    if (page.offset !== rows.length) break;
    rows.push(...page.items);
  }
  return rows;
}

export interface SealedSlice {
  readonly rows: readonly MatchedVacancyItem[];
  readonly total: number;
  readonly facets: SealedMatchedList['facets'];
  readonly filteredObserved?: SealedMatchedList['filteredObserved'];
  readonly campaignWithHypotheses: SealedMatchedList['campaignWithHypotheses'];
}

/** Страница запроса, если запечатанные строки её целиком покрывают; иначе — нет ответа. */
export function sealedSlice(sealed: SealedMatchedList, offset: number, limit: number): SealedSlice | undefined {
  const prefix = sealedPrefix(sealed);
  const end = Math.min(offset + limit, sealed.total);
  if (offset >= sealed.total || end > prefix.length) return undefined;
  return {
    rows: prefix.slice(offset, end),
    total: sealed.total,
    facets: sealed.facets,
    filteredObserved: sealed.filteredObserved,
    campaignWithHypotheses: sealed.campaignWithHypotheses,
  };
}

interface SealedRequest {
  readonly candidateId: string;
  readonly context: B640ListContext;
  readonly filters: MatchedVacancyFilters;
  readonly saved: VacancySort;
  readonly sort: string;
  readonly direction: string;
  readonly offset: number;
  readonly limit: number;
}

/**
 * B702 (prod 17.11): первый запрос подборки нового процесса ждал пул 10–20 с и получал 503. Как
 * прежний маршрут (PRB-055), он отвечает из списка прошлого процесса — только в запомненном
 * порядке и только когда процесс ещё не держит список кандидата; настоящий строится за ответом.
 */
export function readB640Sealed(
  deps: RouteDeps,
  backgroundDeps: RouteDeps,
  request: FastifyRequest,
  input: SealedRequest,
): SealedSlice | undefined {
  const { candidateId, context, filters, saved } = input;
  if (input.sort !== saved.by || input.direction !== saved.dir) return undefined;
  let slice: SealedSlice | undefined;
  try {
    const sealed = readSealedMatchedList({
      ...context,
      candidateStore: deps.candidateStore,
      candidateId,
      filters,
      order: matchedOrderChoiceKeys(deps, candidateId, saved),
    });
    slice = sealed ? sealedSlice(sealed, input.offset, input.limit) : undefined;
  } catch (error) {
    // Строка, которая не открылась, — холодное чтение, а не отказ.
    request.log.warn({ errorName: error instanceof Error ? error.name : 'UnknownError' }, 'b640-unseal-failed');
    return undefined;
  }
  if (!slice) return undefined;
  const { offset: _offset, sort: _sort, dir: _dir, ...listFilters } = filters;
  rebuildBehindSealedList(backgroundDeps, candidateId, listFilters, request.log);
  return slice;
}
