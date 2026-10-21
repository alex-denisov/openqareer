import type { CareerStrategy } from '../../shared/careerStrategy';
import { titleKey } from '../../shared/poolRoleHypotheses';
import type {
  RoleSkillAssessmentRun,
  RoleSkillRequirementSummary,
} from '../domain/roleSkillAssessment';
import { readCampaign } from './campaignContext';
import type { RouteDeps } from './deps';
import {
  focusCase,
  lackingSkillNote,
  planFocusSkills,
  type ValidatedFocus,
} from './roleSkillAssessmentFocus';
import {
  createInitialAssessmentRun,
  readRoleSnapshot,
  summarizeAssessmentContext,
  toAssessmentVacancies,
  type AssessmentContext,
} from './roleSkillAssessmentRoutes';

/** Besides the selected role, at most this many other campaign roles are searched. */
const MAX_OTHER_ROLES = 3;

export type FocusedStart =
  | { readonly state: 'run'; readonly run: RoleSkillAssessmentRun }
  | {
      readonly state: 'focus_insufficient';
      readonly roleTitle: string;
      readonly skills: readonly string[];
      readonly notes: readonly string[];
    }
  | Exclude<AssessmentContext, { state: 'ready' }>;

interface RoleSample {
  readonly roleTitle: string;
  readonly matched: NonNullable<
    Extract<Awaited<ReturnType<typeof readRoleSnapshot>>, { state: 'matched' }>['vacancies']
  >;
  readonly roleNote: string | null;
}

/**
 * The sample comes from the vacancy's own role: the selected one when the vacancy is in its
 * matched pool, else the first campaign role that holds it; otherwise the selected role with
 * an explicit note.
 */
async function readFocusSample(
  deps: RouteDeps,
  candidateId: string,
  selectedRole: string,
  focus: ValidatedFocus,
): Promise<RoleSample | { readonly state: 'source_unavailable' }> {
  const holds = (matched: RoleSample['matched']) =>
    matched.some(
      ({ cluster, explanation }) =>
        cluster.id === focus.vacancyId && explanation.roleMatch === 'target',
    );
  const selected = await readRoleSnapshot(deps, candidateId, selectedRole);
  if (selected.state !== 'matched') return selected;
  if (holds(selected.vacancies))
    return { roleTitle: selectedRole, matched: selected.vacancies, roleNote: null };
  const others = readCampaign(deps.candidateStore, candidateId)
    .roles.value.filter((role) => titleKey(role) !== titleKey(selectedRole))
    .slice(0, MAX_OTHER_ROLES);
  for (const role of others) {
    const snapshot = await readRoleSnapshot(deps, candidateId, role);
    if (snapshot.state === 'matched' && holds(snapshot.vacancies))
      return {
        roleTitle: role,
        matched: snapshot.vacancies,
        roleNote: `Кейсы по вакансиям роли «${role}» из ваших гипотез; результат относится к выбранной роли «${selectedRole}».`,
      };
  }
  return {
    roleTitle: selectedRole,
    matched: selected.vacancies,
    roleNote: `Вакансия «${focus.vacancyTitle}» не относится к вашим ролям; кейсы по вакансиям выбранной роли «${selectedRole}».`,
  };
}

/** The run keeps five skills: the focus ones are key, the role's common ones fill the rest. */
function withRoleSkills(
  covered: readonly RoleSkillRequirementSummary[],
  roleSkills: readonly RoleSkillRequirementSummary[],
): RoleSkillRequirementSummary[] {
  const coveredIds = new Set(covered.map((item) => item.skillId));
  const fill = roleSkills
    .filter((item) => !coveredIds.has(item.skillId))
    .map((item) => ({ ...item, isKeySkill: false }));
  return [...covered, ...fill].slice(0, 5);
}

/** B552: a check limited to the offered vacancy's skills, with honest «мало данных». */
export async function startFocusedRun(
  deps: RouteDeps,
  candidateId: string,
  strategy: CareerStrategy,
  focus: ValidatedFocus,
): Promise<FocusedStart> {
  const selectedRole = strategy.current.role.title;
  const sample = await readFocusSample(deps, candidateId, selectedRole, focus);
  if ('state' in sample) return sample;
  const context = summarizeAssessmentContext(
    sample.roleTitle,
    strategy.current.version,
    sample.matched,
  );
  if (context.state !== 'ready') return context;
  const roleId = titleKey(sample.roleTitle);
  const vacancies = toAssessmentVacancies(sample.matched, roleId, new Date());
  const plans = planFocusSkills(focus, vacancies, context.evidenceObservedAt);
  const covered = plans.flatMap((plan) => (plan.summary ? [plan.summary] : []));
  const lackingNotes = plans.filter((plan) => !plan.summary).map(lackingSkillNote);
  if (covered.length === 0)
    return {
      state: 'focus_insufficient',
      roleTitle: sample.roleTitle,
      skills: focus.skills,
      notes: lackingNotes,
    };

  const skills = withRoleSkills(covered, context.skills);
  const cases = covered.map((summary, index) => focusCase(summary, roleId, index));
  const base = createInitialAssessmentRun({
    ...context,
    roleTitle: selectedRole,
    skills,
    cases,
  });
  return {
    state: 'run',
    run: {
      ...base,
      focus: {
        vacancyId: focus.vacancyId,
        vacancyTitle: focus.vacancyTitle,
        skills: [...focus.skills],
        sampleRoleTitle: sample.roleTitle,
        roleNote: sample.roleNote,
        lackingNotes,
      },
    },
  };
}
