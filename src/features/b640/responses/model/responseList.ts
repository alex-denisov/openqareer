import type { ApplyConsentEntry, ApplyConsentResult } from '../../../../../shared/applyConsent';
import { deliveryState } from '../../../../../shared/applicationStage';
import type {
  B640ContactMessageKind,
  B640SentContactMessage,
} from '../../../../../shared/b640ContactMessage';
import type { ApplicationView } from '../../../applications/applicationsApi';
import {
  applicationGotReply,
  applicationReachedStage,
  type SourceBreakdownItem,
} from '../../../applications/pipelineAnalytics';
import type { IconName } from '../../kit';
import { responsePlatform, viaPlatform, type Platform } from './platform';
import { wasSent } from './sentState';
import { longDate, shortDate, type ResponseRow } from './responseRow';

export interface ListedResponse {
  readonly application: ApplicationView;
  readonly row: ResponseRow;
  /** B680: отклик отправлен автооткликом. */
  readonly auto?: boolean;
}

/** Чипы над списком: стадии и «Авто» (B680) — признак автоотклика, он сужает выбранные стадии. */
export type StageChip = 'active' | 'interview' | 'offer' | 'archive' | 'auto';

export const STAGE_CHIPS: readonly { readonly id: StageChip; readonly label: string }[] = [
  { id: 'active', label: 'В работе' },
  { id: 'interview', label: 'Интервью' },
  { id: 'offer', label: 'Офферы' },
  { id: 'archive', label: 'Архив' },
  { id: 'auto', label: 'Авто' },
];

/** Отмечает автоотклики по списку сервера (B680). */
export function markAuto(
  items: readonly ListedResponse[],
  autoIds: ReadonlySet<string>,
): readonly ListedResponse[] {
  return items.map((item) => ({ ...item, auto: autoIds.has(item.application.id) }));
}

function chipOf(application: ApplicationView): Exclude<StageChip, 'auto'> {
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
  const counts: Record<StageChip, number> = {
    active: 0,
    interview: 0,
    offer: 0,
    archive: 0,
    auto: 0,
  };
  return items.reduce(
    (acc, item) => ({
      ...acc,
      [chipOf(item.application)]: acc[chipOf(item.application)] + 1,
      auto: acc.auto + (item.auto ? 1 : 0),
    }),
    counts,
  );
}

export function filterRows(
  items: readonly ListedResponse[],
  chips: readonly StageChip[],
): readonly ListedResponse[] {
  const stages = chips.filter((chip) => chip !== 'auto');
  const autoOnly = chips.includes('auto');
  return items.filter(
    (item) =>
      (!autoOnly || item.auto === true) &&
      (stages.length === 0 || stages.includes(chipOf(item.application))),
  );
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
  /** B645: числа воронки — только ручные отклики; автоотклики считаются отдельно. */
  readonly sent: number;
  /** B680: отправлено автооткликами. */
  readonly auto: number;
  /** B645: ответы компаний на автоотклики. */
  readonly autoResponded: number;
  readonly responded: number;
  /** Интервью и офферы — по истории, как строка пути на «Сегодня» (решение CPO 25.11). */
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

function sum(
  items: readonly SourceBreakdownItem[],
  pick: (item: SourceBreakdownItem) => number,
): number {
  return items.reduce((total, item) => total + pick(item), 0);
}

/** Площадка словами кандидата: внутренние коды источников сливаются в «Сайт компании». */
function platformLabel(platform: Platform): string {
  return platform.site ? 'Сайт компании' : platform.label;
}

/** Отклики по площадкам; все числа — по истории, как строка пути на «Сегодня». */
function byPlatform(applications: readonly ApplicationView[]): readonly SourceBreakdownItem[] {
  const groups = new Map<string, readonly ApplicationView[]>();
  for (const application of applications) {
    const label = platformLabel(responsePlatform(application));
    groups.set(label, [...(groups.get(label) ?? []), application]);
  }
  const reached = (items: readonly ApplicationView[], stage: 'interview' | 'offer') =>
    items.filter((item) => applicationReachedStage(item, stage)).length;
  return [...groups]
    .map(([label, items]) => ({
      source: label,
      sourceLabel: label,
      total: items.length,
      responded: items.filter(applicationGotReply).length,
      interview: reached(items, 'interview'),
      offer: reached(items, 'offer'),
    }))
    .sort((a, b) => b.total - a.total);
}

export function funnelSummary(items: readonly ListedResponse[]): FunnelSummary {
  const sentAll = items.filter((item) => wasSent(item.application));
  const autoItems = sentAll.filter((item) => item.auto === true);
  const sentItems = sentAll.filter((item) => item.auto !== true);
  const sources = byPlatform(sentItems.map((item) => item.application));
  const first = sentItems.reduce<number | null>(
    (min, item) => (min === null || item.row.sentAt < min ? item.row.sentAt : min),
    null,
  );
  return {
    sent: sentItems.length,
    auto: autoItems.length,
    autoResponded: autoItems.filter((item) => applicationGotReply(item.application)).length,
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
  /** B787: согласие, подтверждённое за кандидата; его текст открывается из события. */
  readonly consent?: ApplyConsentEntry;
}

const STAGE_EVENTS: Partial<Record<ApplicationView['stage'], { icon: IconName; title: string }>> = {
  responded: { icon: 'mail', title: 'Ответ работодателя' },
  interview: { icon: 'mail', title: 'Приглашение на интервью' },
  offer: { icon: 'trophy', title: 'Оффер' },
  rejected: { icon: 'close', title: 'Отказ' },
  archived: { icon: 'down', title: 'В архиве' },
};

function event(
  icon: IconName,
  title: string,
  iso: string | null | undefined,
  note: string | null = null,
): TimelineEvent[] {
  const at = iso ? new Date(iso).getTime() : Number.NaN;
  const when = shortDate(iso);
  return Number.isNaN(at) || !when ? [] : [{ icon, title, note, when, at }];
}

/** B698: сообщение, которое кандидат отметил «Отправил», — в «Что было» с именем получателя. */
const MESSAGE_EVENTS: Record<B640ContactMessageKind, { icon: IconName; title: string }> = {
  known_contact: { icon: 'chat', title: 'Написали знакомому' },
  ask_introduction: { icon: 'handshake', title: 'Попросили представить' },
  recruiter: { icon: 'chat', title: 'Написали рекрутёру' },
};

const messageEvents = (messages: readonly B640SentContactMessage[]): TimelineEvent[] =>
  messages.flatMap((message) => {
    const shown = MESSAGE_EVENTS[message.kind];
    return event(shown.icon, shown.title, message.sentAt, message.recipientName);
  });

const CONSENT_RESULT: Record<ApplyConsentResult, string> = {
  sent: 'отклик отправлен',
  failed: 'отклик не отправлен',
  unconfirmed: 'отправка не подтверждена',
};

/** B787: согласия, подтверждённые по поручению кандидата. */
const consentEvents = (consents: readonly ApplyConsentEntry[]): TimelineEvent[] =>
  consents.flatMap((consent) => {
    const last = consent.results.at(-1);
    const note = [consent.host, ...(last ? [CONSENT_RESULT[last.result]] : [])].join(' · ');
    return event('checkc', 'Подтверждено согласие на обработку данных', consent.occurredAt, note).map((item) => ({
      ...item,
      consent,
    }));
  });

/**
 * «Что было» по отклику: только события, у которых известна дата. Свежие сверху.
 */
export function timeline(
  application: ApplicationView,
  now: Date = new Date(),
  messages: readonly B640SentContactMessage[] = [],
  consents: readonly ApplyConsentEntry[] = [],
): readonly TimelineEvent[] {
  if (application.stage === 'saved') return consentEvents(consents);
  const via = viaPlatform(responsePlatform(application));
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
    ...messageEvents(messages),
    ...consentEvents(consents),
  ];
  return [...events].sort((a, b) => b.at - a.at);
}
