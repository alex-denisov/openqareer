import type { FastifyRequest } from 'fastify';
import '../../shared/geo/serverGeoDirectory';
import { parseVacancyLocation } from '../../shared/locationTree';
import { parseRemoteScope, remoteScopeLabel } from '../../shared/remoteScope';
import { vacancyFitPercent } from '../../shared/vacancyFitPercent';
import { detectVacancyWorkFormat, workFormatLabel } from '../../shared/vacancyWorkFormat';
import { selectionSummary, type SelectionContext, type SelectionRow } from '../coach/selectionSummary';
import type { MatchedVacancyItem } from '../vacancies/multiSourceVacancyEngine';
import { readB640PoolRows } from './b640MatchedVacancyRoutes';
import { readB640ListContext } from './b640VacancyContext';
import { salaryLine } from './coachSubjectContext';
import type { RouteDeps } from './deps';

/** B735: столько строк подборки консультант видит в ходе — первая страница списка. */
export const SELECTION_CONTEXT_ROWS = 20;

type PercentOf = (item: MatchedVacancyItem) => number | null;

const defaultPercentOf: PercentOf = (item) => vacancyFitPercent(item.explanation.fitView);

/** Площадки пишут «Remote» в поле места: это формат, а не место. */
const REMOTE_PLACE = /^(?:remote(?:ly)?|удал[её]нн?о|удал[её]нка|anywhere|worldwide|hybrid|гибрид)$/iu;

function placeParts(location: string | undefined): readonly string[] {
  return (location ?? '').split(',').map((part) => part.trim()).filter(Boolean);
}

function locationOf(location: string | undefined): string | null {
  const place = placeParts(location).filter((part) => !REMOTE_PLACE.test(part)).join(', ');
  return place.slice(0, 200) || null;
}

function formatOf(cluster: MatchedVacancyItem['cluster']): string | null {
  const format =
    cluster.workFormat ??
    detectVacancyWorkFormat({
      location: cluster.canonicalLocation,
      summary: cluster.descriptionSummary,
      isRemote: cluster.isRemote,
    });
  // Место «Remote» при формате «офис»: данные вакансии спорят, формат неизвестен.
  const saysRemote = placeParts(cluster.canonicalLocation).some((part) => /^(?:remote|удал)/iu.test(part));
  if (format === 'office' && saysRemote) return null;
  if (format !== 'remote') return workFormatLabel(format) ?? null;
  return remoteScopeLabel(parseRemoteScope(cluster.remoteScope)).slice(0, 120);
}

function rowOf(item: MatchedVacancyItem, index: number, percentOf: PercentOf): SelectionRow {
  const { cluster } = item;
  const location = locationOf(cluster.canonicalLocation);
  return {
    n: index + 1,
    title: cluster.canonicalTitle.slice(0, 200),
    // Имя частного лица — не компания, в ход оно не идёт (INC-023).
    company: cluster.employerIsPerson ? null : cluster.canonicalCompany.slice(0, 200) || null,
    location,
    country: (location && parseVacancyLocation({ location })?.country) || null,
    format: formatOf(cluster),
    salary: salaryLine(cluster.salary)?.slice(0, 120) ?? null,
    fitPercent: percentOf(item),
  };
}

/** Пронумерованные строки подборки в порядке списка и готовая сводка по ним (B735). */
export function selectionContextOf(
  items: readonly MatchedVacancyItem[],
  percentOf: PercentOf = defaultPercentOf,
): SelectionContext {
  const rows = items
    .slice(0, SELECTION_CONTEXT_ROWS)
    .map((item, index) => rowOf(item, index, percentOf));
  return { total: items.length, summary: selectionSummary(rows), rows };
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
