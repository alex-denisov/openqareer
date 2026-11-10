import { APPLICATION_STAGES, type ApplicationStage } from '../../../shared/applicationStage';
import type { ApplicationListQuery, ApplicationView } from './applicationsApi';
import type { ResponsesPeriod } from './responsesFilterDraft';
import { humanSourceLabel } from './sourceLabels';
import { waitingLabel } from './waitingLabel';

export type ResponsesSortMode = 'step' | 'newest' | 'oldest';

export const OPEN_APPLICATION_STAGES: readonly ApplicationStage[] = [
  'saved',
  'applied',
  'responded',
  'interview',
  'offer',
];

const OPEN_STAGE_SET: ReadonlySet<ApplicationStage> = new Set(OPEN_APPLICATION_STAGES);

export function isOpenStage(stage: ApplicationStage): boolean {
  return OPEN_STAGE_SET.has(stage);
}

/**
 * The period only trims closed responses (B632): an open one still waits for a step,
 * however long ago it was sent, so it never drops out of the list.
 */
export function withinResponsesPeriod(
  application: ApplicationView,
  query: Pick<ApplicationListQuery, 'from' | 'to'>,
): boolean {
  if (isOpenStage(application.stage)) return true;
  const date = application.createdAt.slice(0, 10);
  return (!query.from || date >= query.from) && (!query.to || date <= query.to);
}

export function filterResponseCohort(
  applications: readonly ApplicationView[],
  query: ApplicationListQuery,
): readonly ApplicationView[] {
  return applications.filter((application) => {
    if (query.channel?.length && !query.channel.includes(application.vacancy?.source ?? '')) {
      return false;
    }
    return withinResponsesPeriod(application, query);
  });
}

export function countResponseStages(
  applications: readonly ApplicationView[],
): Record<ApplicationStage, number> {
  const counts = Object.fromEntries(APPLICATION_STAGES.map((stage) => [stage, 0])) as Record<
    ApplicationStage,
    number
  >;
  for (const application of applications) counts[application.stage] += 1;
  return counts;
}

export function searchResponses(
  applications: readonly ApplicationView[],
  query: string,
): readonly ApplicationView[] {
  const needle = normalizeSearch(query);
  if (!needle) return applications;
  return applications.filter((application) =>
    normalizeSearch(searchableText(application)).includes(needle),
  );
}

export function filterResponsesForQuery(
  applications: readonly ApplicationView[],
  query: ApplicationListQuery,
  search: string,
  actionOnly: boolean,
  sortMode: ResponsesSortMode,
): readonly ApplicationView[] {
  const stageFiltered = applications.filter((application) => {
    if (query.stage?.length && !query.stage.includes(application.stage)) return false;
    if (query.channel?.length && !query.channel.includes(application.vacancy?.source ?? '')) {
      return false;
    }
    if (!withinResponsesPeriod(application, query)) return false;
    return !actionOnly || isResponseNeedingAction(application);
  });
  return sortResponses(searchResponses(stageFiltered, search), sortMode);
}

/** Closed responses that match every filter but the period: «Есть N откликов старше…». */
export function countHiddenByPeriod(
  applications: readonly ApplicationView[],
  query: ApplicationListQuery,
  search: string,
  actionOnly: boolean,
): number {
  if (!query.from && !query.to) return 0;
  const undated = { ...query, from: undefined, to: undefined };
  const all = filterResponsesForQuery(applications, undated, search, actionOnly, 'step').length;
  return all - filterResponsesForQuery(applications, query, search, actionOnly, 'step').length;
}

/**
 * The server applies dates to every stage. Open-only filters go without dates; a mix of
 * open and closed stages under a period cannot be said to the server, so it is null.
 */
export function bulkFilterQuery(query: ApplicationListQuery): ApplicationListQuery | null {
  if (!query.from && !query.to) return query;
  const stages = query.stage ?? [];
  if (stages.length > 0 && stages.every(isOpenStage)) {
    return { ...query, from: undefined, to: undefined };
  }
  if (stages.length > 0 && !stages.some(isOpenStage)) return query;
  return null;
}

export interface ResponsesFilterState {
  readonly query: ApplicationListQuery;
  readonly period: ResponsesPeriod;
  readonly search: string;
  readonly actionOnly: boolean;
}

export interface RevealedResponseFilters extends ResponsesFilterState {
  readonly view: 'columns' | 'table';
}

/**
 * A link to one response (from «Сегодня» or a notification) widens the filters until that
 * response is in the list. Null when it is already there.
 */
export function revealApplicationFilters(
  application: ApplicationView,
  current: ResponsesFilterState,
): RevealedResponseFilters | null {
  const { query, search, actionOnly } = current;
  const visible = filterResponsesForQuery([application], query, search, actionOnly, 'step');
  if (visible.length > 0) return null;
  const open = isOpenStage(application.stage);
  return {
    query: open
      ? { ...query, stage: OPEN_APPLICATION_STAGES, channel: [] }
      : { ...query, stage: [application.stage], channel: [], from: undefined, to: undefined },
    period: open ? current.period : 'all',
    search: '',
    actionOnly: false,
    view: open ? 'columns' : 'table',
  };
}

function searchableText(application: ApplicationView): string {
  const vacancy = application.vacancy;
  const company = vacancy?.companyHidden ? '' : (vacancy?.company ?? '');
  const source = vacancy?.source ?? '';
  return [vacancy?.title ?? '', company, source, humanSourceLabel(source)].join(' ');
}

function normalizeSearch(value: string): string {
  return value.trim().replace(/\s+/gu, ' ').toLocaleLowerCase('ru-RU');
}

export function sortResponses(
  applications: readonly ApplicationView[],
  mode: ResponsesSortMode,
): readonly ApplicationView[] {
  return [...applications].sort((left, right) => compareResponses(left, right, mode));
}

function compareResponses(
  left: ApplicationView,
  right: ApplicationView,
  mode: ResponsesSortMode,
): number {
  if (mode === 'step') {
    const dueOrder = compareOptionalDates(nextStepAt(left), nextStepAt(right));
    if (dueOrder) return dueOrder;
  } else {
    const createdOrder = left.createdAt.localeCompare(right.createdAt);
    if (createdOrder) return mode === 'newest' ? -createdOrder : createdOrder;
  }
  return left.id.localeCompare(right.id);
}

function nextStepAt(application: ApplicationView): string | null {
  return (
    application.followUp?.dueAt ??
    application.followUpDueAt ??
    application.nearestInterview?.scheduledAt ??
    null
  );
}

function compareOptionalDates(left: string | null, right: string | null): number {
  if (left === right) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return left.localeCompare(right);
}

export function countResponsesNeedingAction(applications: readonly ApplicationView[]): number {
  return applications.filter(isResponseNeedingAction).length;
}

export function isResponseNeedingAction(application: ApplicationView): boolean {
  return (
    waitingLabel({
      stage: application.stage,
      whoseTurn: application.whoseTurn,
      hasMaterials: application.materials.coverLetter || application.materials.resume,
      followUp: application.followUp,
      nearestInterviewNeedsPrep:
        application.nearestInterview !== null &&
        application.nearestInterview.prepStatus !== 'ready',
      closedReason: application.closedReason,
    }).on === 'you'
  );
}

export function lastDaysRange(days: number, today = new Date()): { from: string; to: string } {
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const start = new Date(end);
  start.setDate(start.getDate() - Math.max(1, Math.trunc(days)) + 1);
  return { from: localIsoDate(start), to: localIsoDate(end) };
}

function localIsoDate(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
