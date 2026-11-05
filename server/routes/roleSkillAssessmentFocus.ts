import { z } from 'zod';
import { canonicalizeSkill } from '../connectors/managementSkillsDictionary';
import type {
  RoleAssessmentVacancy,
  RoleSkillCase,
  RoleSkillRequirementSummary,
  RoleSkillSourceRef,
} from '../domain/roleSkillAssessment';
import {
  extractVacancyRequirements,
  vacancyDescriptionHash,
  type VacancyRequirement,
} from '../domain/vacancyRequirements';
import { labelVacancyRequirement } from '../domain/vacancyRequirementLabel';
import type { RouteDeps } from './deps';
import { readVacancyFitTarget } from './vacancyFitContext';

/** A consultant offer names at most this many skills of one vacancy (B552). */
export const MAX_FOCUS_SKILLS = 3;
/**
 * A focus case needs the skill in this many vacancies, the offered one included. G5 R1b: the
 * quiz is about the opened vacancy's own unconfirmed skills, so that vacancy is enough; the
 * role sample only adds dated sources.
 */
export const FOCUS_MIN_VACANCIES = 1;

export const focusSchema = z
  .object({
    vacancyId: z.string().trim().min(1).max(200),
    skills: z.array(z.string().trim().min(1).max(200)).min(1).max(MAX_FOCUS_SKILLS),
  })
  .strict();
export type AssessmentFocusRequest = z.infer<typeof focusSchema>;

export interface ValidatedFocus {
  readonly vacancyId: string;
  readonly vacancyTitle: string;
  /** The skills as the card names them: the chip name, else the requirement text. */
  readonly skills: readonly string[];
}

export type FocusValidation =
  | { readonly ok: true; readonly focus: ValidatedFocus }
  | {
      readonly ok: false;
      readonly status: 400 | 404 | 409;
      readonly code: string;
      readonly message: string;
    };

const key = (value: string) => value.trim().toLocaleLowerCase('ru-RU');

/** The chip keeps 40 characters of a requirement without a short name; same rule as the card. */
const CHIP_TEXT_LIMIT = 40;
const chipText = (text: string): string =>
  text.length <= CHIP_TEXT_LIMIT ? text : `${text.slice(0, CHIP_TEXT_LIMIT - 1).trimEnd()}…`;

/** Every spelling the card can send for a requirement → the name the check uses. */
export function focusSkillNames(
  requirements: readonly VacancyRequirement[],
): ReadonlyMap<string, string> {
  const names = new Map<string, string>();
  for (const item of requirements.map(labelVacancyRequirement)) {
    const text = item.text.trim();
    const name = item.label?.trim() || text;
    for (const form of [name, text, chipText(text)]) {
      if (form && !names.has(key(form))) names.set(key(form), name);
    }
  }
  return names;
}

/** The requirements the vacancy card shows (`VacancyMechanicsRuntime.view`): same row, same fallback. */
function shownRequirements(
  deps: RouteDeps,
  vacancyId: string,
  description: string,
): readonly VacancyRequirement[] {
  const store = deps.vacancyMechanics?.requirements;
  const current = store?.getLatestOrLegacy(vacancyId, vacancyDescriptionHash(description));
  // The card may have been read from another text of the vacancy; its names stay valid too.
  const latest = store?.getLatestOrLegacy(vacancyId);
  const stored = [...(current?.requirements ?? []), ...(latest?.requirements ?? [])];
  if (stored.length > 0) return stored;
  return description.trim()
    ? extractVacancyRequirements({ vacancyId, description }).requirements
    : [];
}

/** Every focus skill must be a requirement of this vacancy; anything else is rejected. */
export function validateFocus(deps: RouteDeps, request: AssessmentFocusRequest): FocusValidation {
  const target = readVacancyFitTarget(deps, request.vacancyId);
  if (!target)
    return {
      ok: false,
      status: 404,
      code: 'focus_vacancy_not_found',
      message: 'Вакансия не найдена.',
    };
  const requirements = shownRequirements(deps, request.vacancyId, target.description);
  if (requirements.length === 0)
    return {
      ok: false,
      status: 409,
      code: 'focus_requirements_unavailable',
      message: 'Требования этой вакансии ещё не разобраны.',
    };
  const names = focusSkillNames(requirements);
  const skills: string[] = [];
  for (const skill of request.skills) {
    // A repeated chip name ends in « · 2» on the card.
    const name = names.get(key(skill.replace(/ · \d+$/u, '')));
    if (!name)
      return {
        ok: false,
        status: 400,
        code: 'focus_skill_not_in_vacancy',
        message: `«${skill}» нет среди требований этой вакансии.`,
      };
    if (!skills.includes(name)) skills.push(name);
  }
  return { ok: true, focus: { vacancyId: request.vacancyId, vacancyTitle: target.title, skills } };
}

export function focusSkillId(value: string): string {
  return (
    canonicalizeSkill(value)
      .trim()
      .toLocaleLowerCase('ru-RU')
      .normalize('NFKC')
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/gu, '')
      .slice(0, 70) || 'skill'
  );
}

function mentions(requirementSkillId: string, skillId: string): boolean {
  return (
    requirementSkillId === skillId ||
    requirementSkillId.split('-').join(' ').includes(skillId.split('-').join(' ')) ||
    skillId.split('-').join(' ').includes(requirementSkillId.split('-').join(' '))
  );
}

export interface FocusSkillPlan {
  readonly name: string;
  readonly skillId: string;
  /** Role vacancies mentioning the skill, the offered vacancy included. */
  readonly vacancyCount: number;
  readonly summary: RoleSkillRequirementSummary | null;
}

/**
 * For each focus skill: the offered vacancy's requirement plus the same skill in the role
 * sample. Below FOCUS_MIN_VACANCIES the skill gets no case — «мало данных» instead.
 */
export function planFocusSkills(
  focus: ValidatedFocus,
  roleVacancies: readonly RoleAssessmentVacancy[],
  observedAt: string,
): FocusSkillPlan[] {
  return focus.skills.map((name) => {
    const skillId = focusSkillId(name);
    const refs: RoleSkillSourceRef[] = [
      {
        id: `focus-${focus.vacancyId}-${skillId}`.slice(0, 160),
        vacancyId: focus.vacancyId,
        observedAt,
        sourceName: 'Требования вакансии',
      },
    ];
    const vacancyIds = new Set([focus.vacancyId]);
    for (const vacancy of roleVacancies) {
      if (vacancy.status !== 'active' || vacancy.freshness !== 'fresh') continue;
      const requirement = vacancy.requirements.find((item) => mentions(item.skillId, skillId));
      if (!requirement || vacancyIds.has(vacancy.id)) continue;
      vacancyIds.add(vacancy.id);
      refs.push(...requirement.sourceRefs.slice(0, 1));
    }
    const vacancyCount = vacancyIds.size;
    const summary =
      vacancyCount >= FOCUS_MIN_VACANCIES
        ? {
            requirementId: `focus-requirement-${skillId}`.slice(0, 240),
            skillId,
            name,
            vacancyCount,
            isKeySkill: true,
            sourceRefs: refs.slice(0, 100),
          }
        : null;
    return { name, skillId, vacancyCount, summary };
  });
}

export function focusCase(
  summary: RoleSkillRequirementSummary,
  roleId: string,
  index: number,
): RoleSkillCase {
  return {
    id: `focus-case-${index + 1}-${summary.skillId}`.slice(0, 240),
    roleId,
    requirementId: summary.requirementId,
    skillId: summary.skillId,
    skillName: summary.name,
    prompt: `Расскажите о практической ситуации, в которой вы применяли «${summary.name}». Как вы выбрали действия, учли риски и проверили результат?`,
    requirementsCount: summary.vacancyCount,
    sourceRefs: summary.sourceRefs,
  };
}

/** Honest «мало данных» line for a skill that got no case. */
export function lackingSkillNote(plan: FocusSkillPlan): string {
  return `Мало данных по ${plan.name}: навык есть в ${plan.vacancyCount} из нужных ${FOCUS_MIN_VACANCIES} вакансий роли.`;
}
