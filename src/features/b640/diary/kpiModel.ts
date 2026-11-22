import type { CareerDiaryHorizon } from '../../../../shared/careerDiary';
import type { CareerDiaryGoalSetter } from '../../../../shared/careerDiaryCards';
import {
  kpiWeightSum,
  type CareerDiaryKpiAcceptRow,
  type CareerDiaryKpiImport,
} from '../../../../shared/careerDiaryKpi';
import { longDate } from './goalsModel';

/** Строка проверки d02l: то, что кандидат видит и правит; пустое — не нашлось в источнике. */
export interface KpiDraftRow {
  readonly id: string;
  readonly title: string;
  readonly target: string;
  readonly horizon: CareerDiaryHorizon | '';
  readonly weight: string;
  readonly setBy: CareerDiaryGoalSetter | '';
  readonly dueDate: string | null;
  readonly ok: boolean;
}

export type KpiAcceptResult =
  | { readonly rows: readonly CareerDiaryKpiAcceptRow[] }
  | { readonly errors: Readonly<Record<string, string>> }
  | { readonly sum: string };

const SOURCE_LABEL = { text: 'Из текста', table: 'Из таблицы', photo: 'Из фото' } as const;

export function draftRows(draft: CareerDiaryKpiImport): KpiDraftRow[] {
  return draft.rows.map((row) => ({
    id: row.id,
    title: row.title,
    target: row.target || (row.targetValue === null ? '' : `${row.targetValue} ${row.unit}`.trim()),
    horizon: row.horizon ?? '',
    weight: row.weight === null ? '' : String(row.weight),
    setBy: row.setBy ?? '',
    dueDate: row.dueDate,
    ok: true,
  }));
}

/** «7 дней» → 7 и «дней»; цель без числа впереди остаётся словами. */
export function splitTarget(target: string): { targetValue: number | string; unit: string } {
  const match = /^(\d+(?:[.,]\d+)?)\s*(.*)$/u.exec(target.trim());
  if (!match) return { targetValue: target.trim(), unit: '' };
  return { targetValue: Number(match[1]!.replace(',', '.')), unit: match[2]!.trim() };
}

/** Последний день периода: этот квартал, следующий или год. */
export function horizonEnd(horizon: CareerDiaryHorizon, today: string): string {
  const year = Number(today.slice(0, 4));
  if (horizon === 'year') return `${year}-12-31`;
  const quarter =
    Math.floor((Number(today.slice(5, 7)) - 1) / 3) + (horizon === 'next_quarter' ? 1 : 0);
  const endYear = year + Math.floor(quarter / 4);
  const endMonth = (quarter % 4) * 3 + 3;
  const lastDay = new Date(Date.UTC(endYear, endMonth, 0)).getUTCDate();
  return `${endYear}-${String(endMonth).padStart(2, '0')}-${lastDay}`;
}

function parseWeight(weight: string): number | null {
  const value = Number(weight.replace('%', '').replace(',', '.').trim());
  return weight.trim() === '' || !Number.isFinite(value) ? null : value;
}

function accepted(row: KpiDraftRow, today: string): CareerDiaryKpiAcceptRow | null {
  if (!row.title.trim() || !row.target.trim() || !row.horizon || !row.setBy) return null;
  return {
    title: row.title.trim(),
    ...splitTarget(row.target),
    dueDate: row.dueDate ?? horizonEnd(row.horizon, today),
    horizon: row.horizon,
    weight: parseWeight(row.weight),
    setBy: row.setBy,
  };
}

export function acceptRows(rows: readonly KpiDraftRow[], today: string): KpiAcceptResult {
  const chosen = rows.filter((row) => row.ok);
  const errors = Object.fromEntries(
    chosen
      .filter((row) => accepted(row, today) === null)
      .map((row) => [row.id, 'Укажите цель и срок']),
  );
  if (chosen.length === 0 || Object.keys(errors).length > 0) return { errors };
  const result = chosen.map((row) => accepted(row, today)!);
  const sum = kpiWeightSum(result);
  if (sum !== null && Math.abs(sum - 100) > 0.5)
    return { sum: `Вес в сумме — ${sum} %, нужно 100 %` };
  return { rows: result };
}

/** «Вес в сумме — 60 %» по отмеченным строкам; `null`, если весов нет. */
export function weightLine(rows: readonly KpiDraftRow[]): string | null {
  const sum = kpiWeightSum(
    rows.filter((row) => row.ok).map((row) => ({ weight: parseWeight(row.weight) })),
  );
  return sum === null ? null : `Вес в сумме — ${sum} %`;
}

export function sourceLine(draft: CareerDiaryKpiImport): string {
  const name = draft.sourceName ? ` ${draft.sourceName}` : '';
  const day = longDate(draft.createdAt.slice(0, 10), draft.createdAt.slice(0, 10));
  return `${SOURCE_LABEL[draft.sourceKind]}${name}, загружено ${day}.`;
}

const HORIZON_WORD: Readonly<Record<CareerDiaryHorizon, string>> = {
  quarter: 'квартал',
  next_quarter: 'дальше',
  year: 'год',
};
const SETTER_WORD: Readonly<Record<CareerDiaryGoalSetter, string>> = {
  manager: 'руководитель',
  team: 'команда',
  self: 'вы',
};

/** Подпись строки списка d02l на 390: «квартал · вес 30 % · руководитель». */
export function rowSummary(row: KpiDraftRow): string {
  const weight = row.weight.trim();
  return [
    row.horizon ? HORIZON_WORD[row.horizon] : '',
    weight ? `вес ${weight} %` : '',
    row.setBy ? SETTER_WORD[row.setBy] : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

/** ⓘ «Как считается вес» на 390. */
export function weightNote(rows: readonly KpiDraftRow[]): string {
  const sum = weightLine(rows);
  const base = 'Замеры вносятся в карточке цели';
  return sum ? `${base}; ${sum.charAt(0).toLowerCase()}${sum.slice(1)}.` : `${base}.`;
}
