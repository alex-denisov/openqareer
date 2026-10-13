import { APPLICATION_STAGES, type ApplicationStage } from '../../../shared/applicationStage';
import type { ApplicationListQuery, ApplicationView } from './applicationsApi';
import { humanSourceLabel } from './sourceLabels';
import { waitingLabel } from './waitingLabel';

export type ResponsesSortMode = 'step' | 'newest' | 'oldest';

export function filterResponseCohort(
  applications: readonly ApplicationView[],
  query: ApplicationListQuery,
): readonly ApplicationView[] {
  return applications.filter((application) => {
    if (query.channel?.length && !query.channel.includes(application.vacancy?.source ?? '')) {
      return false;
    }
    const date = application.createdAt.slice(0, 10);
    return (!query.from || date >= query.from) && (!query.to || date <= query.to);
  });
}

export function countResponseStages(
  applications: readonly ApplicationView[],
): Record<ApplicationStage, number> {
  const counts = Object.fromEntries(
    APPLICATION_STAGES.map((stage) => [stage, 0]),
  ) as Record<ApplicationStage, number>;
  for (const application of applications) counts[application.stage] += 1;
  return counts;
}

export function searchResponses(
  applications: readonly ApplicationView[],
  query: string,
): readonly ApplicationView[] {
  const needle = normalizeSearch(query);
  if (!needle) return applications;
  return applications.filter((application) => normalizeSearch(searchableText(application)).includes(needle));
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
    const date = application.createdAt.slice(0, 10);
    if (query.from && date < query.from) return false;
    if (query.to && date > query.to) return false;
    return !actionOnly || isResponseNeedingAction(application);
  });
  return sortResponses(searchResponses(stageFiltered, search), sortMode);
}

function searchableText(application: ApplicationView): string {
  const vacancy = application.vacancy;
  const company = vacancy?.companyHidden ? '' : vacancy?.company ?? '';
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
  return waitingLabel({
    stage: application.stage,
    whoseTurn: application.whoseTurn,
    hasMaterials: application.materials.coverLetter || application.materials.resume,
    followUp: application.followUp,
    nearestInterviewNeedsPrep:
      application.nearestInterview !== null && application.nearestInterview.prepStatus !== 'ready',
    closedReason: application.closedReason,
  }).on === 'you';
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
