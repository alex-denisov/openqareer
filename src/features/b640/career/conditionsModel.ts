import { formatGeography, formatSalaryFloor } from '../../career-map/careerConditionsStorage';
import type { SearchConditionsDraft } from '../../career-map/careerScreenTypes';

export type ConditionField = 'geo' | 'salary' | 'format' | 'stop';

export interface ConditionRow {
  readonly field: ConditionField;
  readonly label: string;
  /** `null` — не указано: условие поиск не ограничивает. */
  readonly value: string | null;
  readonly action: 'Изменить' | 'Указать';
}

const MAX_SALARY = 100_000_000;

function formatOf(format: SearchConditionsDraft['format']): string | null {
  const parts = [
    format.office ? 'офис' : null,
    format.hybrid ? 'гибрид' : null,
    format.remote ? 'удалённо' : null,
  ].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(', ') : null;
}

function row(field: ConditionField, label: string, value: string | null): ConditionRow {
  return { field, label, value, action: value === null ? 'Указать' : 'Изменить' };
}

/** Четыре строки условий (макет c10): каждое значение правится отдельно. */
export function conditionRows(conditions: SearchConditionsDraft): readonly ConditionRow[] {
  const salary = formatSalaryFloor(conditions.salaryFrom.amountRubles);
  const stop = conditions.stopList.map((company) => company.name).join(', ');
  return [
    row('geo', 'География', formatGeography(conditions.geography.selected)),
    row('salary', 'Зарплата от', salary ? `${salary} на руки` : null),
    row('format', 'Формат', formatOf(conditions.format)),
    row('stop', 'Стоп-лист', stop || null),
  ];
}

export type SalaryParse =
  | { readonly ok: true; readonly value: number | null }
  | { readonly ok: false; readonly error: string };

export function parseSalary(text: string): SalaryParse {
  const digits = text.replace(/[\s\u00A0]/gu, '');
  if (digits === '') return { ok: true, value: null };
  if (!/^\d+$/u.test(digits) || Number(digits) === 0) {
    return { ok: false, error: 'Введите сумму цифрами' };
  }
  const value = Number(digits);
  return value > MAX_SALARY ? { ok: false, error: 'Слишком большая сумма' } : { ok: true, value };
}

export function formatSalaryInput(value: number | null): string {
  return value === null ? '' : value.toLocaleString('ru-RU').replace(/\u00A0/gu, ' ');
}

export const SAVED_TEXT = 'Сохранено · подборка обновится';
