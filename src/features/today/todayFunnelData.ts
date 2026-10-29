import { pluralRu } from '../../../shared/pluralRu';
import { todayMomentumMetricValue, type TodaySnapshot } from './todayApi';

/** Каталог из подбора: найдено по роли и уровню и время наблюдения. */
export interface TodayFunnelContext {
  readonly found?: number;
  readonly catalogObservedAt?: string;
}

export type TodayFunnelValue = number | 'unknown';

export interface TodayFunnelStage {
  readonly key: 'found' | 'favorites' | 'applied' | 'responses' | 'interviews' | 'offers';
  readonly label: string;
  readonly value: TodayFunnelValue;
}

export const TODAY_FUNNEL_LOW_SAMPLE = 10;
const LOW_SAMPLE = TODAY_FUNNEL_LOW_SAMPLE;

function count(value: number | undefined): TodayFunnelValue {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 'unknown';
}

export function todayFunnelStages(
  snapshot: Pick<TodaySnapshot, 'momentum' | 'funnel'>,
  context?: TodayFunnelContext,
): readonly TodayFunnelStage[] {
  return [
    { key: 'found', label: 'Найдено', value: count(context?.found) },
    { key: 'favorites', label: 'В избранном', value: count(snapshot.funnel?.favorites) },
    {
      key: 'applied',
      label: 'Откликов',
      value:
        snapshot.funnel?.applied === undefined
          ? todayMomentumMetricValue(snapshot.momentum, '30d', 'applied')
          : count(snapshot.funnel.applied),
    },
    { key: 'responses', label: 'Ответов', value: count(snapshot.funnel?.responses) },
    {
      key: 'interviews',
      label: 'Интервью',
      value:
        snapshot.funnel?.interviews === undefined
          ? todayMomentumMetricValue(snapshot.momentum, '30d', 'interviews')
          : count(snapshot.funnel.interviews),
    },
    { key: 'offers', label: 'Офферов', value: count(snapshot.funnel?.offers) },
  ];
}

export function funnelDateTime(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
    .format(date)
    .replace(',', '');
}

function stageValue(stages: readonly TodayFunnelStage[], key: TodayFunnelStage['key']) {
  return stages.find((stage) => stage.key === key)?.value ?? 'unknown';
}

/** Подпись 1440 по макету: «n = 7 откликов, 07.10 09:12». */
export function todayFunnelBasis(
  snapshot: Pick<TodaySnapshot, 'momentum' | 'funnel'>,
  stages: readonly TodayFunnelStage[],
): string {
  const applied = stageValue(stages, 'applied');
  if (applied === 'unknown') return 'Нет проверенных данных об откликах';
  const date = funnelDateTime(snapshot.momentum?.calculatedAt);
  return `n = ${pluralRu(applied, ['отклик', 'отклика', 'откликов'])}${date ? `, ${date}` : ''}`;
}

/** Фраза под воронкой на 390 по макету; неизвестные этапы называются, а не подставляются. */
export function todayFunnelFootnote(
  snapshot: Pick<TodaySnapshot, 'momentum' | 'funnel'>,
  stages: readonly TodayFunnelStage[],
): string {
  const found = stageValue(stages, 'found');
  const offers = stageValue(stages, 'offers');
  const unknown = stages.filter((stage) => stage.value === 'unknown').map((stage) => stage.label);
  return [
    found === 'unknown' ? undefined : `Найдено в каталоге: ${found}.`,
    offers === 'unknown' ? undefined : `Офферов пока ${offers}.`,
    unknown.length
      ? `Нет проверенных данных по ${unknown.length === 1 ? 'этапу' : 'этапам'}: ${unknown.map((label) => `«${label}»`).join(', ')}.`
      : undefined,
  ]
    .filter(Boolean)
    .join(' ');
}

/** Содержимое ⓘ у «Воронка за 30 дней»: на чём построена воронка и можно ли ей верить. */
export function todayFunnelInfo(
  snapshot: Pick<TodaySnapshot, 'momentum' | 'funnel'>,
  stages: readonly TodayFunnelStage[],
): string {
  return `${todayFunnelBasis(snapshot, stages)}. ${todayFunnelHint(stages, snapshot.momentum?.calculatedAt)}`;
}

/** Подсказка «Пояснение» у «Воронка за 30 дней» на 1440, дословно по макету 1. */
export function todayFunnelHint(
  stages: readonly TodayFunnelStage[],
  calculatedAt: string | undefined,
): string {
  const date = funnelDateTime(calculatedAt);
  const applied = stageValue(stages, 'applied');
  return [
    date ? `Ваши данные на ${date};` : 'Ваши данные;',
    '«найдено» — каталог openqareer на ту же дату.',
    applied !== 'unknown' && applied < LOW_SAMPLE
      ? `Откликов меньше ${LOW_SAMPLE}: на выводы о конверсии это не годится.`
      : undefined,
  ]
    .filter(Boolean)
    .join(' ');
}
