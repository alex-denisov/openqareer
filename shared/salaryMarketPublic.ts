/** Stable semantic paths for the exact roles in the prepared public catalog. */
export function salaryRolePath(role: string): string | undefined {
  return /^[a-z0-9][a-z0-9]*(?:-[a-z0-9]+)*$/u.test(role) && role.length <= 100
    ? `/salaries/${role}`
    : undefined;
}

import { salarySkillTrendHasChanges } from './salaryMarketSnapshot';
import type {
  SalaryMarketGrade,
  SalaryMarketProfession,
  SalaryMarketSnapshot,
} from './salaryMarketSnapshot';

export const SALARY_GRADE_LABELS: Readonly<Record<SalaryMarketGrade, string>> = {
  junior: 'Junior',
  middle: 'Middle',
  senior: 'Senior',
  lead: 'Lead',
  unknown: 'Грейд не подтверждён',
};
export function isSalaryMarketGrade(value: string): value is SalaryMarketGrade {
  return Object.hasOwn(SALARY_GRADE_LABELS, value);
}
/** A grade view always uses its own prepared denominator and comparable salary groups. */
export function selectSalaryGrade(
  snapshot: SalaryMarketSnapshot | null,
  grade?: SalaryMarketGrade,
): SalaryMarketSnapshot | null {
  if (!snapshot || !grade) return snapshot;
  const slice = snapshot.gradeSlices?.find((row) => row.grade === grade && row.sampleSize > 0);
  return slice
    ? {
        ...snapshot,
        sampleSize: slice.sampleSize,
        skills: slice.skills,
        salary: slice.salary,
        skillQuarterlyTrend: slice.skillQuarterlyTrend,
        quarterlyTrend: salarySkillTrendHasChanges(slice.skillQuarterlyTrend)
          ? 'available'
          : 'unavailable',
      }
    : null;
}

/** Explicit display abbreviation; the complete source stays in the prepared snapshot/catalog. */
export function salaryDisplayLabel(value: string, limit = 40): string {
  const prefix: string[] = [];
  for (const character of value) {
    if (prefix.length === limit) return `${prefix.join('')}…`;
    prefix.push(character);
  }
  return prefix.join('');
}

/** Current canonical ontology labels fit in 64 characters; unknown source titles use a tighter preview. */
export function salaryRoleLabel(value: {
  readonly roleLabel: string;
  readonly profession?: SalaryMarketProfession;
}): string {
  return salaryDisplayLabel(value.roleLabel, value.profession?.kind === 'b267' ? 64 : 40);
}

/** Prepared public projection; never carries candidate input or profile facts. */
export interface SalaryMarketSkillSummary {
  readonly role: string;
  readonly grade: SalaryMarketGrade | null;
  readonly updatedAt: string;
  readonly sampleSize: number;
  readonly source: SalaryMarketSnapshot['source'];
  readonly skills: SalaryMarketSnapshot['skills'];
}
