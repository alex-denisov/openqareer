import { z } from 'zod';
import { canonicalizeSkill } from '../connectors/managementSkillsDictionary';
import type {
  RoleAssessmentVacancy,
  RoleSkillCase,
  RoleSkillRequirementSummary,
  RoleSkillSourceRef,
} from '../domain/roleSkillAssessment';
import type { RouteDeps } from './deps';
import { readVacancyFitTarget } from './vacancyFitContext';

/** A consultant offer names at most this many skills of one vacancy (B552). */
export const MAX_FOCUS_SKILLS = 3;
/** A focus case needs the skill in this many role vacancies, the offered one included. */
export const FOCUS_MIN_VACANCIES = 3;

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
  /** Requirement texts of the vacancy, as the fit analysis extracted them. */
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
  const extracted = deps.vacancyMechanics?.requirements.getLatest(request.vacancyId);
  if (!extracted || extracted.requirements.length === 0)
    return {
      ok: false,
      status: 409,
      code: 'focus_requirements_unavailable',
      message: 'Требования этой вакансии ещё не разобраны.',
    };
  const byKey = new Map(extracted.requirements.map((item) => [key(item.text), item.text.trim()]));
  const skills: string[] = [];
  for (const skill of request.skills) {
    const text = byKey.get(key(skill));
    if (!text)
      return {
        ok: false,
        status: 400,
        code: 'focus_skill_not_in_vacancy',
        message: `«${skill}» нет среди требований этой вакансии.`,
      };
    if (!skills.includes(text)) skills.push(text);
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
