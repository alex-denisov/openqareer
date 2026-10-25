import type { RouteDeps } from './deps';
import { readVacancyFitTarget } from './vacancyFitContext';
import { SHOWN_PAGE_PRIORITY } from '../domain/vacancyMechanicsRuntime';
import {
  extractVacancyRequirements,
  vacancyDescriptionHash,
  VACANCY_REQUIREMENTS_EXTRACTOR_VERSION,
} from '../domain/vacancyRequirements';
import { labelVacancyRequirement } from '../domain/vacancyRequirementLabel';

/**
 * One opened check queues model extraction for at most this many vacancies: the worker's
 * B556 budget caps the spend, and the next opening queues the next slice.
 */
export const ROLE_EXTRACTION_SLICE = 40;

export interface RoleRequirementReader {
  /** Skill names for a vacancy whose cluster carries none. */
  skillsFor(vacancyId: string): readonly string[];
  /** Vacancies of this read that have no extracted requirements yet and were queued. */
  readonly pendingCount: () => number;
}

/**
 * B509: cluster skills are empty for most sources, so the check reads skills from the
 * vacancy requirements cache (rules until the model answers). Per-vacancy lookups only,
 * never a scan of the pool on the HTTP path.
 */
export function createRoleRequirementReader(deps: RouteDeps): RoleRequirementReader | undefined {
  const runtime = deps.vacancyMechanics;
  if (!runtime) return undefined;
  let queued = 0;
  let pending = 0;
  return {
    pendingCount: () => pending,
    skillsFor(vacancyId) {
      const target = readVacancyFitTarget(deps, vacancyId);
      if (!target?.description.trim()) return [];
      const input = { vacancyId, description: target.description };
      const extracted = runtime.requirements.getLatestOrLegacy(
        vacancyId,
        vacancyDescriptionHash(target.description),
      );
      if (
        extracted?.extractorVersion !== VACANCY_REQUIREMENTS_EXTRACTOR_VERSION &&
        queued < ROLE_EXTRACTION_SLICE
      ) {
        queued += 1;
        if (!extracted) pending += 1;
        runtime.requirements.enqueue(input, { titleStrategyPriority: SHOWN_PAGE_PRIORITY });
      }
      const requirements = (extracted ?? extractVacancyRequirements(input)).requirements;
      const labels = requirements
        .map(labelVacancyRequirement)
        .flatMap((requirement) =>
          requirement.skill && requirement.label ? [requirement.label.trim()] : [],
        );
      return [...new Set(labels)];
    },
  };
}
