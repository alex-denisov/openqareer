import type { ApplicationStage } from '../../../shared/applicationStage';
import type { ApplicationListQuery, ApplicationView } from './applicationsApi';
import {
  filterResponsesForQuery,
  lastDaysRange,
  type ResponsesSortMode,
} from './responsesFiltering';

export type ResponsesPeriod = '7' | '30' | '90' | 'all';

/** What the 390 filter sheet holds until «Показать». `stage` is a funnel summary key. */
export interface ResponsesFilterDraft {
  readonly stage: string;
  readonly channel: string;
  readonly period: ResponsesPeriod;
  readonly sortMode: ResponsesSortMode;
}

export const DEFAULT_FILTER_DRAFT: ResponsesFilterDraft = {
  stage: 'все',
  channel: '',
  period: '30',
  sortMode: 'step',
};

const ACTION_ONLY_STAGE = 'нужно действие';

const STAGES_BY_KEY: Readonly<Record<string, readonly ApplicationStage[]>> = {
  все: [],
  [ACTION_ONLY_STAGE]: [],
  'ждут ответа': ['applied'],
  ответили: ['responded'],
  интервью: ['interview'],
  оффер: ['offer'],
  закрыто: ['rejected', 'archived'],
};

const PERIOD_DEPTH: Readonly<Record<ResponsesPeriod, number>> = {
  '7': 7,
  '30': 30,
  '90': 90,
  all: Number.POSITIVE_INFINITY,
};

function periodRange(period: ResponsesPeriod, today: Date): { from?: string; to?: string } {
  return period === 'all' ? {} : lastDaysRange(Number(period), today);
}

/** The list «Показать N» will open, counted from the rows already loaded. */
export function draftResultCount(
  applications: readonly ApplicationView[],
  draft: ResponsesFilterDraft,
  search: string,
  today: Date = new Date(),
): number {
  const query: ApplicationListQuery = {
    stage: [...(STAGES_BY_KEY[draft.stage] ?? [])],
    channel: draft.channel ? [draft.channel] : [],
    ...periodRange(draft.period, today),
  };
  return filterResponsesForQuery(
    applications,
    query,
    search,
    draft.stage === ACTION_ONLY_STAGE,
    draft.sortMode,
  ).length;
}

/** Only the applied period's rows are loaded; a longer draft period needs the server. */
export function draftCoveredByLoaded(loaded: ResponsesPeriod, draft: ResponsesPeriod): boolean {
  return PERIOD_DEPTH[draft] <= PERIOD_DEPTH[loaded];
}

/** One row of the draft list: its `meta.total` is the count. Null when the server cannot filter it. */
export function draftListQuery(
  draft: ResponsesFilterDraft,
  today: Date = new Date(),
): ApplicationListQuery | null {
  if (draft.stage === ACTION_ONLY_STAGE) return null;
  return {
    stage: [...(STAGES_BY_KEY[draft.stage] ?? [])],
    channel: draft.channel ? [draft.channel] : [],
    ...periodRange(draft.period, today),
    limit: 1,
    offset: 0,
  };
}
