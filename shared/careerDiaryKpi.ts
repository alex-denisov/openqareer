import type { CareerDiaryHorizon } from './careerDiary';
import type { CareerDiaryGoalSetter } from './careerDiaryCards';

/**
 * B686: разбор KPI из текста, таблицы или фото слайда в черновик целей дневника B640.
 * Кандидат проверяет черновик, правит и принимает: каждая строка становится целью.
 */
export const KPI_SOURCE_KINDS = ['text', 'table', 'photo'] as const;
export type CareerDiaryKpiSourceKind = (typeof KPI_SOURCE_KINDS)[number];

export const KPI_TEXT_MAX = 20_000;
/** Файл таблицы или фото слайда, байт до кодирования. */
export const KPI_FILE_MAX_BYTES = 4 * 1024 * 1024;
export const KPI_ROWS_MAX = 20;
export const KPI_TABLE_MIME_TYPES = [
  'text/csv',
  'text/tab-separated-values',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
] as const;
export const KPI_PHOTO_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

/** Строка черновика: только то, что нашлось в источнике; чего нет — `null`. */
export interface CareerDiaryKpiRow {
  readonly id: string;
  readonly title: string;
  /** Цель как в источнике: «7 дней», «95 %», «не больше 2 в месяц». */
  readonly target: string;
  readonly targetValue: number | null;
  readonly unit: string;
  readonly dueDate: string | null;
  readonly horizon: CareerDiaryHorizon | null;
  /** Вес в процентах. */
  readonly weight: number | null;
  readonly setBy: CareerDiaryGoalSetter | null;
  /** Фрагмент источника, из которого взята строка. */
  readonly quote: string;
}

export interface CareerDiaryKpiImport {
  readonly id: string;
  readonly sourceKind: CareerDiaryKpiSourceKind;
  readonly sourceName: string | null;
  readonly createdAt: string;
  readonly rows: readonly CareerDiaryKpiRow[];
  /** Сумма весов, если вес есть хотя бы у одной строки. */
  readonly weightSum: number | null;
  readonly acceptedGoalIds: readonly string[];
  readonly sourceStored: boolean;
}

export type CareerDiaryKpiImportInput =
  | { readonly kind: 'text'; readonly text: string }
  | {
      readonly kind: 'table' | 'photo';
      readonly name: string;
      readonly mimeType: string;
      /** base64 */
      readonly data: string;
    };

/** Принятая кандидатом строка: после правки, поэтому все поля обязательны. */
export interface CareerDiaryKpiAcceptRow {
  readonly title: string;
  readonly unit: string;
  readonly targetValue: number | string;
  readonly dueDate: string;
  readonly horizon: CareerDiaryHorizon;
  readonly weight: number | null;
  readonly setBy: CareerDiaryGoalSetter;
}

export interface CareerDiaryKpiAcceptInput {
  readonly rows: readonly CareerDiaryKpiAcceptRow[];
}

export function kpiWeightSum(rows: readonly { readonly weight: number | null }[]): number | null {
  const weights = rows
    .map((row) => row.weight)
    .filter((weight): weight is number => weight !== null);
  if (weights.length === 0) return null;
  return Math.round(weights.reduce((sum, weight) => sum + weight, 0) * 10) / 10;
}
