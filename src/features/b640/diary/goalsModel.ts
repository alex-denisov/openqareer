import type {
  CareerDiaryGoalRiskStatus,
  CareerDiaryGoalSummary,
  CareerDiaryHorizon,
  CareerDiaryValue,
} from '../../../../shared/careerDiary';
import type {
  CareerDiaryGoalArchive,
  CareerDiaryGoalCard,
  CareerDiaryGoalSetter,
  CareerDiaryQuarterTarget,
} from '../../../../shared/careerDiaryCards';
import { shortDate } from './model';

/** Модель экранов «Цели и показатели» (d02, d02a, d02b). */

const MONTHS_GEN = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
];
const QUARTERS = ['I', 'II', 'III', 'IV'];
const STALE_DAYS = 14;
const DAY_MS = 86_400_000;

export const HORIZONS: readonly { readonly value: CareerDiaryHorizon; readonly label: string }[] = [
  { value: 'quarter', label: 'Квартал' },
  { value: 'year', label: 'Год' },
  { value: 'next_quarter', label: 'Дальше' },
];

export const SETTERS: readonly { readonly value: CareerDiaryGoalSetter; readonly label: string }[] =
  [
    { value: 'self', label: 'Вы' },
    { value: 'manager', label: 'Руководитель' },
    { value: 'team', label: 'Команда' },
  ];

export interface RiskTag {
  readonly text: string;
  readonly className: string;
}

const RISK_TAGS: Record<CareerDiaryGoalRiskStatus, RiskTag> = {
  on_track: { text: 'по плану', className: 'tag ok' },
  planned: { text: 'по плану', className: 'tag ok' },
  achieved: { text: 'достигнута', className: 'tag ok' },
  at_risk: { text: 'отстаёт', className: 'tag part' },
  unknown: { text: 'нет замера', className: 'tag miss' },
};

export function riskTag(status: CareerDiaryGoalRiskStatus): RiskTag {
  return RISK_TAGS[status];
}

/** «12 декабря», с годом — если не текущий. */
export function longDate(date: string, now: string): string {
  const [year, month, day] = date.slice(0, 10).split('-').map(Number);
  const tail = String(year) === now.slice(0, 4) ? '' : ` ${year}`;
  return `${day} ${MONTHS_GEN[(month ?? 1) - 1]}${tail}`;
}

/** ⓘ у цели в архиве: когда убрана и почему. */
export function archiveNote(archive: CareerDiaryGoalArchive, now: string): string {
  const reason = archive.reason.trim();
  const end = /[.!?…]$/u.test(reason) ? '' : '.';
  const day = /^\d{4}-\d{2}-\d{2}/u.test(archive.archivedAt)
    ? ` ${longDate(archive.archivedAt, now)}`
    : '';
  return `Убрана в архив${day}. Причина: ${reason}${end}`;
}

/** B742 d02: «Вклад кварталов: I — 85 %, II — 88 %» у годовой цели; вклада нет — null. */
export function quarterLine(
  targets: readonly CareerDiaryQuarterTarget[] | null,
  unit: string,
): string | null {
  if (!targets || targets.length === 0) return null;
  const parts = [...targets]
    .sort((a, b) => a.quarter - b.quarter)
    .map((item) => {
      const value = formatValue(item.value);
      return `${QUARTERS[item.quarter - 1]} — ${unit ? `${value} ${unit}` : value}`;
    });
  return `Вклад кварталов: ${parts.join(', ')}`;
}

/**
 * B645 d02: на вкладке «Квартал» годовая цель показывает цель этого квартала — «из 85 % в I кв.».
 * Год цели ещё не начался — первый квартал, уже прошёл — последний. Вклада по кварталу нет — null.
 */
export function quarterTargetText(card: CareerDiaryGoalCard, now: string): string | null {
  const targets = card.details.quarterTargets;
  if (card.horizon !== 'year' || !targets || targets.length === 0) return null;
  const goalYear = card.dueDate.slice(0, 4);
  const nowYear = now.slice(0, 4);
  const current = Math.floor((Number(now.slice(5, 7)) - 1) / 3) + 1;
  const quarter = nowYear < goalYear ? 1 : nowYear > goalYear ? 4 : current;
  const target = targets.find((item) => item.quarter === quarter);
  if (!target) return null;
  return `из ${formatValue(target.value, card.unit)} в ${QUARTERS[quarter - 1]} кв.`;
}

/** «IV квартал 2026». */
export function quarterLabel(day: string): string {
  const month = Number(day.slice(5, 7));
  return `${QUARTERS[Math.floor((month - 1) / 3)]} квартал ${day.slice(0, 4)}`;
}

/** «директор · договорились 12 декабря · до 29 января». */
export function goalByline(card: CareerDiaryGoalCard, now: string): string {
  const who = SETTERS.find((setter) => setter.value === card.details.setBy)?.label ?? 'Вы';
  const parts = [who.toLowerCase()];
  if (card.details.agreedOn) parts.push(`договорились ${longDate(card.details.agreedOn, now)}`);
  parts.push(`до ${longDate(card.dueDate, now)}`);
  return parts.join(' · ');
}

export function formatValue(value: CareerDiaryValue, unit = ''): string {
  if (typeof value === 'boolean') return value ? 'сделано' : 'не сделано';
  if (typeof value === 'number') {
    const text = String(value).replace('.', ',');
    return unit === '%' ? `${text} %` : text;
  }
  return value;
}

/** Показатели цели: у старой цели без разбиения показатель — она сама. */
export function indicatorsOf(card: CareerDiaryGoalCard): readonly CareerDiaryGoalSummary[] {
  return card.indicators.length > 0 ? card.indicators : [card];
}

/** Единица часто уже в названии («Срок релиза, дней») — второй раз её не дописываем. */
export function labelWithUnit(label: string, unit: string): string {
  if (!unit || label.trim().endsWith(`, ${unit}`)) return label;
  return `${label}, ${unit}`;
}

export interface IndicatorView {
  readonly id: string;
  readonly title: string;
  /** Значение замера или «не внесено». */
  readonly value: string;
  /** « из 2» или «, цель — 7 и меньше» — с разделителем; пусто, если цель не числовая. */
  readonly target: string;
  readonly sub: string;
}

/** Цель ниже старта (срок, инциденты): «из 4» тут ничего не значит — пишем «цель — 4». */
function decreasing(goal: CareerDiaryGoalSummary): boolean {
  return (
    typeof goal.targetValue === 'number' &&
    goal.baselineValue !== null &&
    goal.targetValue < goal.baselineValue
  );
}

/** Хвост после значения в списке: « из 2» или «, цель — 4 и меньше». */
function targetText(goal: CareerDiaryGoalSummary): string {
  if (typeof goal.targetValue !== 'number') return '';
  const target = formatValue(goal.targetValue, goal.unit);
  return decreasing(goal) ? `, цель — ${target} и меньше` : ` из ${target}`;
}

/** Значение и цель на карточке и в истории (B662): «0 из 2» или «9, цель — 4». */
export function valueWithTarget(
  goal: CareerDiaryGoalSummary,
  value: Parameters<typeof formatValue>[0],
): string {
  const shown = formatValue(value, goal.unit);
  if (typeof goal.targetValue !== 'number') return shown;
  const target = formatValue(goal.targetValue, goal.unit);
  return decreasing(goal) ? `${shown}, цель — ${target}` : `${shown} из ${target}`;
}

export function indicatorView(goal: CareerDiaryGoalSummary): IndicatorView {
  const latest = goal.latestMeasurement;
  const title = goal.unit === '%' ? goal.title : labelWithUnit(goal.title, goal.unit);
  const baseline =
    goal.baselineValue === null ? '' : ` · было ${formatValue(goal.baselineValue, goal.unit)}`;
  return {
    id: goal.id,
    title,
    value: latest ? formatValue(latest.value, goal.unit) : 'не внесено',
    target: latest ? targetText(goal) : '',
    sub: latest
      ? `${shortDate(latest.measuredAt.slice(0, 10))}${baseline}`
      : '— · внесите в итоге недели',
  };
}

/** Самый старый последний замер среди показателей, если он старше двух недель: «3 недели назад». */
export function staleFlag(card: CareerDiaryGoalCard, now: string): string | null {
  if (card.risk.status === 'achieved') return null;
  const dates = indicatorsOf(card)
    .map((goal) => goal.latestMeasurement?.measuredAt.slice(0, 10))
    .filter((date): date is string => Boolean(date));
  if (dates.length === 0) return null;
  const oldest = dates.sort()[0]!;
  const days = Math.floor(
    (Date.parse(`${now}T00:00:00Z`) - Date.parse(`${oldest}T00:00:00Z`)) / DAY_MS,
  );
  if (days < STALE_DAYS) return null;
  const weeks = Math.floor(days / 7);
  return `Последний замер ${weeks} ${plural(weeks, 'неделю', 'недели', 'недель')} назад`;
}

export function plural(count: number, one: string, few: string, many: string): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

export interface GoalsLead {
  readonly title: string;
  /** Отстающая цель: на неё ведёт главная кнопка «Разобрать». */
  readonly focus: CareerDiaryGoalCard | null;
}

/** Заголовок вкладки: что отстаёт, иначе «идут по плану». */
export function goalsLead(cards: readonly CareerDiaryGoalCard[]): GoalsLead {
  const behind = cards.filter((card) => card.risk.status === 'at_risk');
  if (behind.length === 0) {
    const unmeasured = cards.filter((card) => card.risk.status === 'unknown').length;
    if (unmeasured === cards.length) return { title: 'Внесите первые замеры', focus: null };
    return { title: 'Цели идут по плану', focus: null };
  }
  const title =
    behind.length === 1
      ? `Отстаёт «${behind[0]!.title}»`
      : `Отстают ${behind.length} ${plural(behind.length, 'цель', 'цели', 'целей')}`;
  return { title, focus: behind[0]! };
}
