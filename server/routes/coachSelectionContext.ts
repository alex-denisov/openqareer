import type { FastifyRequest } from 'fastify';
import { vacancyFitPercent } from '../../shared/vacancyFitPercent';
import type { MatchedVacancyItem } from '../vacancies/multiSourceVacancyEngine';
import { readB640PoolRows } from './b640MatchedVacancyRoutes';
import { readB640ListContext } from './b640VacancyContext';
import { salaryLine } from './coachSubjectContext';
import type { RouteDeps } from './deps';

/** B735: столько строк подборки консультант видит в ходе — первая страница списка. */
export const SELECTION_CONTEXT_ROWS = 20;

export interface SelectionContextRow {
  readonly title: string;
  readonly company: string | null;
  readonly salary: string | null;
  readonly fitPercent: number | null;
}

export interface SelectionContext {
  readonly total: number;
  readonly rows: readonly SelectionContextRow[];
}

type PercentOf = (item: MatchedVacancyItem) => number | null;

const defaultPercentOf: PercentOf = (item) => vacancyFitPercent(item.explanation.fitView);

/** Подборка в порядке списка кандидата: название, компания, зарплата и процент совпадения. */
export function selectionContextOf(
  items: readonly MatchedVacancyItem[],
  percentOf: PercentOf = defaultPercentOf,
): SelectionContext {
  return {
    total: items.length,
    rows: items.slice(0, SELECTION_CONTEXT_ROWS).map((item) => ({
      title: item.cluster.canonicalTitle.slice(0, 200),
      // Имя частного лица — не компания, в ход оно не идёт (INC-023).
      company: item.cluster.employerIsPerson ? null : item.cluster.canonicalCompany.slice(0, 200) || null,
      salary: salaryLine(item.cluster.salary)?.slice(0, 120) ?? null,
      fitPercent: percentOf(item),
    })),
  };
}

/** Подборка — подсказка консультанту: её сбой не роняет ход и пишется в журнал. */
export async function readCoachSelection(
  deps: RouteDeps,
  request: FastifyRequest,
  candidateId: string,
): Promise<SelectionContext | undefined> {
  try {
    const rows = await readB640PoolRows(deps, request, candidateId, readB640ListContext(deps, candidateId), {});
    return rows ? selectionContextOf(rows) : undefined;
  } catch (error) {
    request.log.warn({ error }, 'coach_selection_context_failed');
    return undefined;
  }
}
