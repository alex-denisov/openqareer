import type { CareerDiaryHorizon } from '../../../../shared/careerDiary';
import {
  GOAL_INDICATORS_MAX,
  type CareerDiaryGoalCard,
  type CareerDiaryGoalCardInput,
  type CareerDiaryGoalSetter,
} from '../../../../shared/careerDiaryCards';
import { indicatorsOf } from './goalsModel';

/** Форма «Новая цель» (d02b) и правка цели тем же экраном. */

export interface IndicatorDraft {
  /** Показатель, который уже есть у цели; `null` — новый. */
  readonly id: string | null;
  readonly title: string;
  readonly now: string;
  readonly target: string;
}

export interface GoalDraft {
  readonly title: string;
  readonly horizon: CareerDiaryHorizon;
  readonly dueDate: string;
  readonly setBy: CareerDiaryGoalSetter;
  readonly indicators: readonly IndicatorDraft[];
}

export type GoalErrors = Partial<Record<'title' | 'dueDate' | 'indicators', string>>;

export const EMPTY_INDICATOR: IndicatorDraft = { id: null, title: '', now: '', target: '' };

export function emptyDraft(): GoalDraft {
  return {
    title: '',
    horizon: 'quarter',
    dueDate: '',
    setBy: 'self',
    indicators: [EMPTY_INDICATOR],
  };
}

function text(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'да' : 'нет';
  return String(value).replace('.', ',');
}

export function draftOf(card: CareerDiaryGoalCard): GoalDraft {
  return {
    title: card.title,
    horizon: card.horizon,
    dueDate: card.dueDate,
    setBy: card.details.setBy,
    indicators: indicatorsOf(card).map((goal) => ({
      id: goal.id,
      title: goal.title,
      now: text(goal.baselineValue),
      target: text(goal.targetValue),
    })),
  };
}

export function parseNumber(raw: string): number | null {
  const value = raw.trim().replace(/\s/gu, '').replace(',', '.');
  if (!value) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/** Цель показателя: число, «да» — сделано, иначе текст как есть. */
export function parseTarget(raw: string): number | boolean | string {
  const number = parseNumber(raw);
  if (number !== null) return number;
  if (/^(да|сделано)$/iu.test(raw.trim())) return true;
  return raw.trim();
}

function filled(indicator: IndicatorDraft): boolean {
  return indicator.title.trim() !== '' || indicator.target.trim() !== '';
}

export function validate(draft: GoalDraft): GoalErrors {
  const indicators = draft.indicators.filter(filled);
  return {
    ...(draft.title.trim() ? {} : { title: 'Назовите цель' }),
    ...(draft.dueDate ? {} : { dueDate: 'Укажите срок' }),
    ...(indicators.length > 0 && indicators.every((item) => item.title.trim() && item.target.trim())
      ? {}
      : { indicators: 'У показателя нужны название и цель' }),
  };
}

export function canAddIndicator(draft: GoalDraft): boolean {
  return draft.indicators.length < GOAL_INDICATORS_MAX;
}

/** Единица — хвост названия после последней запятой: «Время до ревью, часов» → «часов». */
export function unitOf(title: string): string {
  const comma = title.lastIndexOf(',');
  return comma < 0
    ? ''
    : title
        .slice(comma + 1)
        .trim()
        .slice(0, 80);
}

export function cardInput(draft: GoalDraft, startDate: string): CareerDiaryGoalCardInput {
  return {
    title: draft.title.trim(),
    horizon: draft.horizon,
    startDate: startDate < draft.dueDate ? startDate : draft.dueDate,
    dueDate: draft.dueDate,
    setBy: draft.setBy,
    indicators: draft.indicators.filter(filled).map((item) => ({
      title: item.title.trim(),
      unit: unitOf(item.title),
      baselineValue: parseNumber(item.now),
      targetValue: parseTarget(item.target),
    })),
  };
}
