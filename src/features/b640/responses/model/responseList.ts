import { deliveryState } from '../../../../../shared/applicationStage';
import type { ApplicationView } from '../../../applications/applicationsApi';
import {
  computePipelineAnalytics,
  type SourceBreakdownItem,
} from '../../../applications/pipelineAnalytics';
import type { IconName } from '../../kit';
import { platformOf, viaPlatform } from './platform';
import { longDate, shortDate, type ResponseRow } from './responseRow';

export interface ListedResponse {
  readonly application: ApplicationView;
  readonly row: ResponseRow;
}

/** Чипы стадий над списком. «Авто» появится вместе с признаком автоотклика (B680). */
export type StageChip = 'active' | 'interview' | 'offer' | 'archive';

export const STAGE_CHIPS: readonly { readonly id: StageChip; readonly label: string }[] = [
  { id: 'active', label: 'В работе' },
  { id: 'interview', label: 'Интервью' },
  { id: 'offer', label: 'Офферы' },
  { id: 'archive', label: 'Архив' },
];

function chipOf(application: ApplicationView): StageChip {
  switch (application.stage) {
    case 'interview':
      return 'interview';
    case 'offer':
      return 'offer';
    case 'rejected':
    case 'archived':
      return 'archive';
    default:
      return 'active';
  }
}

export function chipCounts(items: readonly ListedResponse[]): Record<StageChip, number> {
  const counts: Record<StageChip, number> = { active: 0, interview: 0, offer: 0, archive: 0 };
  return items.reduce(
    (acc, item) => ({ ...acc, [chipOf(item.application)]: acc[chipOf(item.application)] + 1 }),
    counts,
  );
}

export function filterRows(
  items: readonly ListedResponse[],
  chips: readonly StageChip[],
): readonly ListedResponse[] {
  if (chips.length === 0) return items;
  return items.filter((item) => chips.includes(chipOf(item.application)));
}

export type SortKey = 'role' | 'company' | 'stage' | 'next' | 'sent';

export interface SortState {
  readonly key: SortKey;
  readonly direction: 'asc' | 'desc';
}

export const DEFAULT_SORT: SortState = { key: 'next', direction: 'asc' };

const COLLATOR = new Intl.Collator('ru');

function compare(a: ListedResponse, b: ListedResponse, key: SortKey): number {
  switch (key) {
    case 'role':
      return COLLATOR.compare(a.row.role, b.row.role);
    case 'company':
      return COLLATOR.compare(a.row.company, b.row.company);
    case 'stage':
      return COLLATOR.compare(a.row.tag.label, b.row.tag.label);
    case 'sent':
      return a.row.sentAt - b.row.sentAt;
    default:
      return a.row.urgency - b.row.urgency || b.row.sentAt - a.row.sentAt;
  }
}

export function sortRows(
  items: readonly ListedResponse[],
  sort: SortState,
): readonly ListedResponse[] {
  const sign = sort.direction === 'asc' ? 1 : -1;
  return [...items].sort((a, b) => sign * compare(a, b, sort.key));
}

export interface FunnelSummary {
  readonly sent: number;
  readonly responded: number;
  readonly interview: number;
  readonly offer: number;
  /** Компании, которым можно напомнить о себе. */
  readonly remind: readonly ListedResponse[];
  /** Отправлено и пока без ответа. */
  readonly silent: number;
  /** С какого дня считается воронка: «2 октября». */
  readonly since: string | null;
  readonly sources: readonly SourceBreakdownItem[];
}

function sum(items: readonly SourceBreakdownItem[], pick: (item: SourceBreakdownItem) => number): number {
  return items.reduce((total, item) => total + pick(item), 0);
}

/** Площадки словами кандидата: внутренние коды источников сливаются в «Сайт компании». */
function byPlatform(sources: readonly SourceBreakdownItem[]): readonly SourceBreakdownItem[] {
  const groups = new Map<string, SourceBreakdownItem>();
  for (const source of sources) {
    const platform = platformOf(source.source);
    const label = platform.site ? 'Сайт компании' : platform.label;
    const known = groups.get(label);
    groups.set(label, {
      source: label,
      sourceLabel: label,
      total: (known?.total ?? 0) + source.total,
      responded: (known?.responded ?? 0) + source.responded,
      interview: (known?.interview ?? 0) + source.interview,
      offer: (known?.offer ?? 0) + source.offer,
    });
  }
  return [...groups.values()].sort((a, b) => b.total - a.total);
}

export function funnelSummary(items: readonly ListedResponse[]): FunnelSummary {
  const sentItems = items.filter((item) => item.application.stage !== 'saved');
  const analytics = computePipelineAnalytics(sentItems.map((item) => item.application));
  const sources = byPlatform(analytics.sources);
  const first = sentItems.reduce<number | null>(
    (min, item) => (min === null || item.row.sentAt < min ? item.row.sentAt : min),
    null,
  );
  return {
    sent: sentItems.length,
    responded: sum(sources, (source) => source.responded),
    interview: sum(sources, (source) => source.interview),
    offer: sum(sources, (source) => source.offer),
    remind: sentItems.filter((item) => item.row.remind),
    silent: sentItems.filter(
      (item) => item.application.stage === 'applied' && item.row.failure === null,
    ).length,
    since: first ? longDate(new Date(first).toISOString()) : null,
    sources,
  };
}

export interface TimelineEvent {
  readonly icon: IconName;
  readonly title: string;
  readonly note: string | null;
  readonly when: string;
  readonly at: number;
}

const STAGE_EVENTS: Partial<Record<ApplicationView['stage'], { icon: IconName; title: string }>> = {
  responded: { icon: 'mail', title: 'Ответ работодателя' },
  interview: { icon: 'mail', title: 'Приглашение на интервью' },
  offer: { icon: 'trophy', title: 'Оффер' },
  rejected: { icon: 'close', title: 'Отказ' },
  archived: { icon: 'down', title: 'В архиве' },
};

function event(icon: IconName, title: string, iso: string | null | undefined, note: string | null = null): TimelineEvent[] {
  const at = iso ? new Date(iso).getTime() : Number.NaN;
  const when = shortDate(iso);
  return Number.isNaN(at) || !when ? [] : [{ icon, title, note, when, at }];
}

/**
 * «Что было» по отклику: только события, у которых известна дата. Свежие сверху.
 */
export function timeline(application: ApplicationView, now: Date = new Date()): readonly TimelineEvent[] {
  if (application.stage === 'saved') return [];
  const via = viaPlatform(platformOf(application.vacancy?.source));
  const receipt = application.deliveryReceipt ?? null;
  const delivery = receipt ? deliveryState('applied', receipt) : null;
  const stage = STAGE_EVENTS[application.stage];
  const events = [
    ...event('send', `Отправлен ${via}`, application.appliedAt),
    ...(delivery === 'delivered'
      ? event('checkc', 'Доставлен', application.deliveryReceiptRecordedAt)
      : []),
    ...(delivery === 'failed'
      ? event('warn', 'Не доставлен', application.deliveryReceiptRecordedAt)
      : []),
    ...(stage ? event(stage.icon, stage.title, application.stageChangedAt) : []),
    ...(application.interviewScheduledAt ?? []).flatMap((iso) =>
      new Date(iso).getTime() <= now.getTime()
        ? event('mic', 'Интервью прошло', iso)
        : event('calendar', 'Интервью назначено', iso),
    ),
  ];
  return [...events].sort((a, b) => b.at - a.at);
}
