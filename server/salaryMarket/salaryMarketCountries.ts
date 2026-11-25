import type { DatabaseSync } from 'node:sqlite';
import {
  MIN_COUNTRY_SALARY_SAMPLE,
  type SalaryMarketCountrySlice,
  type SalaryMarketGrade,
} from '../../shared/salaryMarketSnapshot';
import {
  emptySalaryExclusions,
  recordSalaryRange,
  salaryRangeDistribution,
} from './salaryMarketRanges';

type CountryGrade = SalaryMarketGrade | 'all';

export interface CountryCounter {
  record(
    role: string,
    country: string | undefined,
    grade: SalaryMarketGrade,
    clusterId: string,
    salaryJson: string | null,
  ): void;
  assemble(role: string): readonly SalaryMarketCountrySlice[];
}

/** B788: вилки роли по странам, названным источником; страны не складываются в регионы. */
export function prepareSalaryCountries(database: DatabaseSync): CountryCounter {
  const seen = new Map<string, Set<string>>();
  const keyOf = (role: string, scope: string): string => `${role}|country:${scope}`;
  return {
    record(role, country, grade, clusterId, salaryJson) {
      if (!country) return;
      const scopes = (['all', grade] as const).map((level) => `${country}:${level}`);
      const known = seen.get(role) ?? new Set<string>();
      seen.set(role, known);
      for (const scope of scopes) {
        known.add(scope);
        recordSalaryRange(
          database,
          keyOf(role, scope),
          clusterId,
          salaryJson,
          emptySalaryExclusions(),
        );
      }
    },
    assemble(role) {
      return [...(seen.get(role) ?? [])].sort().flatMap((scope) => {
        const salary = salaryRangeDistribution(
          database,
          keyOf(role, scope),
          emptySalaryExclusions(),
        );
        const groups = (salary.status === 'available' ? salary.groups : []).filter(
          (group) => group.sampleSize >= MIN_COUNTRY_SALARY_SAMPLE,
        );
        const [country, grade] = scope.split(':') as [string, CountryGrade];
        return groups.length > 0 ? [{ country, grade, groups }] : [];
      });
    },
  };
}
