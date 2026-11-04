import {
  canonicalizeSkill,
  managementSkillMatcher,
} from '../connectors/managementSkillsDictionary';
import type { RoleAssessmentVacancy } from './roleSkillAssessment';
import { isRoleTitleLabel } from './roleTitleLabel';

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

/** `+` and `#` stay: without them C++, C# and C are one skill. */
function skillKey(name: string): string {
  return canonicalizeSkill(name)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}+#]+/gu, '');
}

/** The letters of `short` follow in `full`, starting from its first letter. */
function abbreviates(short: string, full: string): boolean {
  if (short.length < 2 || short.length >= full.length || short[0] !== full[0]) return false;
  let matched = 0;
  for (const letter of full) {
    if (letter === short[matched]) matched += 1;
  }
  return matched === short.length;
}

interface NamedAbbreviation {
  readonly full: string;
  readonly short: string;
}

/**
 * «Amazon Web Services (AWS)» or «AWS (Amazon Web Services)». Other brackets
 * are not a second name: «Excel (VBA)» says nothing about VBA on its own.
 */
function namedAbbreviation(name: string): NamedAbbreviation | null {
  const match = /^(.+?)\s*\(([^()]+)\)$/u.exec(name.trim());
  if (!match) return null;
  const [outer, inner] = [skillKey(match[1]), skillKey(match[2])];
  const [full, short] = outer.length >= inner.length ? [outer, inner] : [inner, outer];
  return abbreviates(short, full) ? { full, short } : null;
}

interface OwnedSkills {
  readonly texts: readonly string[];
  readonly names: ReadonlySet<string>;
  /** Abbreviations from brackets: they answer only a requirement named by the bare abbreviation. */
  readonly abbreviations: ReadonlySet<string>;
}

function ownedSkills(profileSkills: readonly string[]): OwnedSkills {
  const pairs = profileSkills.map(namedAbbreviation);
  return {
    texts: profileSkills,
    names: new Set(
      [
        ...profileSkills.map(skillKey),
        ...pairs.flatMap((pair) => (pair ? [pair.full] : [])),
      ].filter(Boolean),
    ),
    abbreviations: new Set(pairs.flatMap((pair) => (pair ? [pair.short] : []))),
  };
}

/**
 * Keys are compared whole, so «AI» never matches inside «Email». Two bracketed
 * names sharing an abbreviation stay apart: Project and Product Management (PM).
 */
function isOwned(label: string, owned: OwnedSkills): boolean {
  const key = skillKey(label);
  const pair = namedAbbreviation(label);
  const named = pair
    ? [key, pair.full, pair.short].some((item) => owned.names.has(item))
    : owned.names.has(key) || owned.abbreviations.has(key);
  if (named) return true;
  const dictionary = managementSkillMatcher(label);
  return dictionary ? owned.texts.some((text) => dictionary.test(text)) : false;
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
      if (!key || seen.has(key) || isRoleTitleLabel(label)) continue;
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
  const owned = ownedSkills(profileSkills);
  const skills = [...tallyRequirements(unique).values()]
    .filter((tally) => tally.vacancies >= MIN_SKILL_VACANCIES)
    .map((tally) => {
      const name = commonestLabel(tally.labels);
      return { name, vacancies: tally.vacancies, inProfile: isOwned(name, owned) };
    })
    .sort((a, b) => b.vacancies - a.vacancies || a.name.localeCompare(b.name))
    .slice(0, ROLE_SKILL_DEMAND_TOP);
  if (skills.length === 0) return null;
  const observedAt = unique
    .flatMap((v) => v.requirements.flatMap((r) => r.sourceRefs.map((ref) => ref.observedAt)))
    .sort()
    .at(-1);
  return observedAt ? { roleTitle, sampleSize: unique.length, observedAt, skills } : null;
}
