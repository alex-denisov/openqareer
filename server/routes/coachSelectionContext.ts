import type { FastifyRequest } from 'fastify';
import { parseRemoteScope, remoteScopeLabel } from '../../shared/remoteScope';
import { vacancyFitPercent } from '../../shared/vacancyFitPercent';
import { detectVacancyWorkFormat, workFormatLabel } from '../../shared/vacancyWorkFormat';
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
  /** Место из вакансии; null — площадка его не назвала. */
  readonly location: string | null;
  /** «офис», «гибрид», удалёнка с областью; null — в вакансии не сказано. */
  readonly format: string | null;
  readonly salary: string | null;
  readonly fitPercent: number | null;
}

export interface SelectionContext {
  readonly total: number;
  readonly rows: readonly SelectionContextRow[];
}

type PercentOf = (item: MatchedVacancyItem) => number | null;

const defaultPercentOf: PercentOf = (item) => vacancyFitPercent(item.explanation.fitView);

function formatOf(cluster: MatchedVacancyItem['cluster']): string | null {
  const format =
    cluster.workFormat ??
    detectVacancyWorkFormat({
      location: cluster.canonicalLocation,
      summary: cluster.descriptionSummary,
      isRemote: cluster.isRemote,
    });
  if (format !== 'remote') return workFormatLabel(format) ?? null;
  return remoteScopeLabel(parseRemoteScope(cluster.remoteScope)).slice(0, 120);
}

/** Подборка в порядке списка кандидата: название, компания, место, формат, зарплата и процент совпадения. */
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
      location: item.cluster.canonicalLocation?.trim().slice(0, 200) || null,
      format: formatOf(item.cluster),
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
