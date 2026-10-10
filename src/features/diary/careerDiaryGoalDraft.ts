import type {
  CareerDiaryGoalInput,
  CareerDiaryGoalPatch,
  CareerDiaryGoalSummary,
  CareerDiaryValue,
} from '../../../shared/careerDiary';
import { isDueDateBeforeStart } from './careerDiaryModel';

export type CareerDiaryTargetKind = 'number' | 'text' | 'boolean';
export type CareerDiaryGoalField = 'title' | 'startDate' | 'dueDate' | 'unit' | 'baselineValue' | 'targetValue';
export type CareerDiaryGoalFieldErrors = Partial<Record<CareerDiaryGoalField, string>>;

export interface CareerDiaryGoalDraft {
  readonly title: string;
  readonly type: CareerDiaryGoalInput['type'];
  readonly horizon: CareerDiaryGoalInput['horizon'];
  readonly startDate: string;
  readonly dueDate: string;
  readonly unit: string;
  readonly baselineValue: string;
  readonly targetValue: string;
  readonly targetKind: CareerDiaryTargetKind;
}

export function createCareerDiaryGoalDraft(goal?: CareerDiaryGoalSummary | null): CareerDiaryGoalDraft {
  const targetKind = typeof goal?.targetValue === 'boolean'
    ? 'boolean'
    : typeof goal?.targetValue === 'number' ? 'number' : 'text';
  return {
    title: goal?.title ?? '',
    type: goal?.type ?? 'operational',
    horizon: goal?.horizon ?? 'quarter',
    startDate: goal?.startDate ?? '',
    dueDate: goal?.dueDate ?? '',
    unit: goal?.unit ?? '',
    baselineValue: goal?.baselineValue === null || goal?.baselineValue === undefined
      ? ''
      : String(goal.baselineValue),
    targetValue: goal ? String(goal.targetValue) : '',
    targetKind,
  };
}

export function validateCareerDiaryGoalDraft(draft: CareerDiaryGoalDraft): CareerDiaryGoalFieldErrors {
  const errors: CareerDiaryGoalFieldErrors = {};
  if (!draft.title.trim()) errors.title = 'Укажите название цели.';
  if (!validIsoDate(draft.startDate)) errors.startDate = 'Укажите корректную дату начала.';
  if (!validIsoDate(draft.dueDate)) errors.dueDate = 'Укажите корректный срок.';
  else if (validIsoDate(draft.startDate) && isDueDateBeforeStart(draft.startDate, draft.dueDate)) {
    errors.dueDate = 'Срок не может быть раньше даты начала.';
  }
  if (!draft.unit.trim()) errors.unit = 'Укажите единицу измерения.';
  if (draft.targetKind === 'number' && (!draft.targetValue.trim() || !Number.isFinite(Number(draft.targetValue)))) {
    errors.targetValue = 'Введите числовое целевое значение.';
  }
  if (draft.targetKind === 'text' && !draft.targetValue.trim()) {
    errors.targetValue = 'Укажите целевое значение.';
  }
  if (draft.targetKind === 'boolean' && !['true', 'false'].includes(draft.targetValue)) {
    errors.targetValue = 'Выберите «Да» или «Нет».';
  }
  if (draft.baselineValue.trim() && !Number.isFinite(Number(draft.baselineValue))) {
    errors.baselineValue = 'Исходное значение должно быть числом.';
  }
  return errors;
}

export function careerDiaryGoalInputFromDraft(draft: CareerDiaryGoalDraft): CareerDiaryGoalInput {
  const targetValue: CareerDiaryValue = draft.targetKind === 'number'
    ? Number(draft.targetValue)
    : draft.targetKind === 'boolean' ? draft.targetValue === 'true' : draft.targetValue.trim();
  return {
    title: draft.title.trim(),
    type: draft.type,
    horizon: draft.horizon,
    startDate: draft.startDate,
    dueDate: draft.dueDate,
    unit: draft.unit.trim(),
    baselineValue: draft.targetKind === 'number' && draft.baselineValue.trim()
      ? Number(draft.baselineValue)
      : null,
    targetValue,
  };
}

export function careerDiaryGoalPatchFromDraft(draft: CareerDiaryGoalDraft): CareerDiaryGoalPatch {
  return careerDiaryGoalInputFromDraft(draft);
}

function validIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}
