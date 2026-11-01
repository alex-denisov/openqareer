import { canonicalizeSkill } from '../connectors/managementSkillsDictionary';
import type { RoleAssessmentVacancy } from './roleSkillAssessment';

/** How many of a role's most requested skills the profile shows (B591). */
export const ROLE_SKILL_DEMAND_TOP = 12;
/** A skill one vacancy names is noise, not demand. */
const MIN_SKILL_VACANCIES = 2;

export interface RoleSkillDemandSkill {
  readonly name: string;
  /** Vacancies of the sample whose extracted requirements name this skill. */
  readonly vacancies: number;
  readonly inProfile: boolean;
}

export interface RoleSkillDemand {
  readonly roleTitle: string;
  /** Fresh, active vacancies of the role in the selection. */
  readonly sampleSize: number;
  /** The latest source observation in the sample. */
  readonly observedAt: string;
  readonly skills: readonly RoleSkillDemandSkill[];
}

function skillKey(name: string): string {
  return canonicalizeSkill(name)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

interface Tally {
  readonly labels: Map<string, number>;
  vacancies: number;
}

function tallyRequirements(sample: readonly RoleAssessmentVacancy[]): Map<string, Tally> {
  const tallies = new Map<string, Tally>();
  for (const vacancy of sample) {
    const seen = new Set<string>();
    for (const requirement of vacancy.requirements) {
      const label = requirement.statement.trim();
      const key = skillKey(label);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const tally = tallies.get(key) ?? { labels: new Map<string, number>(), vacancies: 0 };
      tally.vacancies += 1;
      tally.labels.set(label, (tally.labels.get(label) ?? 0) + 1);
      tallies.set(key, tally);
    }
  }
  return tallies;
}

function commonestLabel(labels: ReadonlyMap<string, number>): string {
  return [...labels.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
}

/**
 * The skills real vacancies of one role require most often, from the
 * requirements extracted for the selection, with profile presence. `null`
 * means the block is hidden: too few vacancies, or no skill repeats.
 */
export function buildRoleSkillDemand(
  roleTitle: string,
  roleId: string,
  vacancies: readonly RoleAssessmentVacancy[],
  profileSkills: readonly string[],
  minSample: number,
): RoleSkillDemand | null {
  const sample = vacancies.filter(
    (v) => v.roleId === roleId && v.status === 'active' && v.freshness === 'fresh',
  );
  const unique = [...new Map(sample.map((v) => [v.id, v])).values()];
  if (unique.length < minSample) return null;
  const owned = new Set(profileSkills.map(skillKey).filter(Boolean));
  const skills = [...tallyRequirements(unique).entries()]
    .filter(([, tally]) => tally.vacancies >= MIN_SKILL_VACANCIES)
    .map(([key, tally]) => ({
      name: commonestLabel(tally.labels),
      vacancies: tally.vacancies,
      inProfile: owned.has(key),
    }))
    .sort((a, b) => b.vacancies - a.vacancies || a.name.localeCompare(b.name))
    .slice(0, ROLE_SKILL_DEMAND_TOP);
  if (skills.length === 0) return null;
  const observedAt = unique
    .flatMap((v) => v.requirements.flatMap((r) => r.sourceRefs.map((ref) => ref.observedAt)))
    .sort()
    .at(-1);
  return observedAt ? { roleTitle, sampleSize: unique.length, observedAt, skills } : null;
}
