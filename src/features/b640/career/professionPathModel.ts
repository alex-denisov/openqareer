import type { RoleRow } from './rolesModel';

export interface ProfessionRequirement {
  readonly name: string;
  readonly vacancies: number;
  readonly inProfile: boolean;
}

const key = (value: string): string => value.trim().toLocaleLowerCase('ru');

function requirementWord(total: number): string {
  const mod10 = total % 10;
  const mod100 = total % 100;
  return mod10 === 1 && mod100 !== 11 ? 'требования' : 'требований';
}

/** «4 из 9 требований»: сколько частых требований профессии уже есть в профиле. */
export function requirementsMeta(requirements: readonly ProfessionRequirement[]): string {
  const owned = requirements.filter((item) => item.inProfile).length;
  return `${owned} из ${requirements.length} ${requirementWord(requirements.length)}`;
}

/**
 * Промежуточная роль: роль по профилю с вакансиями, у которой больше всего общих
 * требований с целевой профессией. Без общих требований промежуточной роли нет.
 */
export function bridgeRole(
  rows: readonly RoleRow[],
  target: string,
  requirements: readonly ProfessionRequirement[],
): RoleRow | null {
  const wanted = new Set(requirements.map((item) => key(item.name)));
  const scored = rows
    .filter((row) => key(row.title) !== key(target) && (row.vacancies ?? 0) > 0)
    .map((row) => ({
      row,
      overlap: row.requirements.filter((name) => wanted.has(key(name))).length,
    }))
    .filter((entry) => entry.overlap > 0)
    .sort((a, b) => b.overlap - a.overlap || (b.row.vacancies ?? 0) - (a.row.vacancies ?? 0));
  return scored[0]?.row ?? null;
}

const thousands = (value: number): number => Math.round(value / 1000);

export function formatFork(min: number, max: number): string {
  return `${thousands(min)}–${thousands(max)} тыс. ₽`;
}

export type IncomeShift =
  | { readonly kind: 'lower' | 'higher'; readonly from: number; readonly to: number }
  | { readonly kind: 'same' };

/** Насколько вилка ниже или выше нынешнего дохода, в процентах от него. */
export function incomeShift(min: number, max: number, current: number): IncomeShift {
  const pct = (value: number) => Math.round((Math.abs(current - value) / current) * 100);
  if (max < current) return { kind: 'lower', from: pct(max), to: pct(min) };
  if (min > current) return { kind: 'higher', from: pct(min), to: pct(max) };
  return { kind: 'same' };
}
