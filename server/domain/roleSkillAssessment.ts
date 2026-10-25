import { z } from 'zod';
import { MIN_ROLE_SAMPLE } from '../../shared/poolRoleHypotheses';

/** A requirement counts as repeated in this share of vacancies with extracted requirements. */
const REPEATED_SHARE = 0.2;
const MIN_REPEATED_VACANCIES = 2;

export type RoleSkillGrade = 'confirmed' | 'partial' | 'not_confirmed';

export interface RoleSkillSourceRef {
  readonly id: string;
  readonly vacancyId: string;
  readonly observedAt: string;
  readonly sourceName?: string;
}

export interface RoleSkillRequirement {
  readonly id: string;
  readonly skillId: string;
  readonly statement: string;
  readonly sourceRefs: readonly RoleSkillSourceRef[];
}

export interface RoleAssessmentVacancy {
  readonly id: string;
  readonly roleId: string;
  readonly status: 'active' | 'closed';
  readonly freshness: 'fresh' | 'stale';
  readonly requirements: readonly RoleSkillRequirement[];
}

export interface RoleSkillCase {
  readonly id: string;
  readonly roleId: string;
  readonly requirementId: string;
  readonly skillId: string;
  readonly skillName: string;
  readonly prompt: string;
  readonly requirementsCount: number;
  readonly sourceRefs: readonly RoleSkillSourceRef[];
}

export interface RoleSkillRequirementSummary {
  readonly requirementId: string;
  readonly skillId: string;
  readonly name: string;
  readonly vacancyCount: number;
  readonly isKeySkill: boolean;
  readonly sourceRefs: readonly RoleSkillSourceRef[];
}

export interface RoleSkillCriterion {
  readonly id: string;
  readonly description: string;
}

export interface RoleSkillModelEvaluation {
  readonly grade: RoleSkillGrade;
  readonly criteria: readonly {
    readonly criterionId: string;
    readonly grade: RoleSkillGrade;
    readonly explanation: string;
    readonly candidateExcerpt: string;
    readonly sourceRefIds: readonly string[];
  }[];
}

export interface RoleSkillEvaluation {
  readonly candidateAnswer: string;
  readonly grade: RoleSkillGrade;
  readonly criteria: RoleSkillModelEvaluation['criteria'];
}

export interface RoleSkillReadinessSkill {
  readonly id: string;
  readonly grade: RoleSkillGrade;
  readonly isKeySkill: boolean;
}

export interface RoleSkillProfileChange {
  readonly memoryIds: readonly string[];
  readonly acceptedAt: string | null;
  readonly revertedAt: string | null;
}

const roleSkillGradeSchema = z.enum(['confirmed', 'partial', 'not_confirmed']);
const roleSkillProfileChangeSchema = z
  .object({
    memoryIds: z.array(z.string().uuid()).max(12),
    acceptedAt: z.string().datetime().nullable(),
    revertedAt: z.string().datetime().nullable(),
  })
  .strict();
const roleSkillMemoryDomainSchema = z.enum([
  'responsibility',
  'outcome',
  'skill',
  'preference',
  'constraint',
  'gap',
  'role-evidence',
  'other',
]);

const roleSkillModelEvaluationSchema = z
  .object({
    grade: roleSkillGradeSchema,
    criteria: z
      .array(
        z
          .object({
            criterionId: z.string().trim().min(1).max(80),
            grade: roleSkillGradeSchema,
            explanation: z.string().trim().min(1).max(500),
            candidateExcerpt: z.string().trim().min(1).max(500),
            sourceRefIds: z.array(z.string().trim().min(1).max(160)).min(1).max(20),
          })
          .strict(),
      )
      .min(1)
      .max(10),
  })
  .strict();

const sourceRefSchema = z
  .object({
    id: z.string().trim().min(1).max(160),
    vacancyId: z.string().trim().min(1).max(160),
    observedAt: z.string().datetime(),
    sourceName: z.string().trim().min(1).max(120).optional(),
  })
  .strict();

const roleSkillEvaluationSchema = z
  .object({
    candidateAnswer: z.string().trim().min(1).max(10_000),
    grade: roleSkillGradeSchema,
    criteria: roleSkillModelEvaluationSchema.shape.criteria,
  })
  .strict();

const roleSkillCaseSchema = z
  .object({
    id: z.string().trim().min(1).max(240),
    roleId: z.string().trim().min(1).max(240),
    requirementId: z.string().trim().min(1).max(240),
    skillId: z.string().trim().min(1).max(160),
    skillName: z.string().trim().min(1).max(500),
    prompt: z.string().trim().min(1).max(2_000),
    requirementsCount: z.number().int().positive().max(10_000),
    sourceRefs: z.array(sourceRefSchema).min(1).max(100),
  })
  .strict();

const roleSkillProfileSuggestionSchema = z
  .object({
    id: z.string().uuid(),
    domain: roleSkillMemoryDomainSchema,
    statement: z.string().trim().min(1).max(1_000),
    sourceExcerpt: z.string().trim().min(1).max(500),
    sourceMessageId: z.string().uuid(),
    selected: z.boolean(),
    accepted: z.boolean(),
  })
  .strict();

const roleAssessmentDialogueEntrySchema = z
  .object({
    id: z.string().uuid(),
    question: z.string().trim().min(1).max(1_000),
    answer: z.string().trim().min(1).max(8_000),
    answeredAt: z.string().datetime(),
  })
  .strict();

const roleSkillRunSkillSchema = z
  .object({
    id: z.string().trim().min(1).max(160),
    name: z.string().trim().min(1).max(500),
    isKeySkill: z.boolean(),
    grade: roleSkillGradeSchema,
    explanation: z.string().trim().min(1).max(1_000),
    caseId: z.string().trim().min(1).max(240).nullable(),
    sourceRefs: z.array(sourceRefSchema).max(100),
  })
  .strict();

const roleSkillRunCaseSchema = z
  .object({
    assessmentCase: roleSkillCaseSchema,
    status: z.enum(['pending', 'answered', 'skipped']),
    answer: z.string().max(10_000).nullable(),
    evaluation: roleSkillEvaluationSchema.nullable(),
    evaluationHistory: z.array(roleSkillEvaluationSchema).max(5),
    appealReason: z.string().max(2_000).nullable(),
    pendingDiscussionQuestion: z.string().max(2_000).nullable(),
    discussion: z
      .array(
        z
          .object({
            question: z.string().trim().min(1).max(2_000),
            answer: z.string().trim().min(1).max(2_000),
            createdAt: z.string().datetime(),
          })
          .strict(),
      )
      .max(10),
  })
  .strict();

const roleAssessmentRequestSchema = z
  .object({
    id: z.string().uuid(),
    digest: z.string().regex(/^[a-f0-9]{64}$/u),
  })
  .strict();

const roleSkillAssessmentRunSchema = z
  .object({
    id: z.string().uuid(),
    revision: z.number().int().positive(),
    roleTitle: z.string().trim().min(1).max(200),
    roleVersion: z.number().int().positive(),
    status: z.enum(['dialogue', 'suggestions', 'cases', 'complete', 'model_error']),
    consentedAt: z.string().datetime(),
    startedAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    completedAt: z.string().datetime().nullable(),
    // G5 R1b: a vacancy-focused run may rest on a thin role sample; the role check keeps
    // its own MIN_ROLE_SAMPLE gate before a run is created.
    sampleSize: z.number().int().min(1).max(10_000),
    evidenceObservedAt: z.string().datetime(),
    dialogueQuestions: z.array(z.string().trim().min(1).max(1_000)).length(3),
    dialogueEntries: z.array(roleAssessmentDialogueEntrySchema).max(3),
    currentDialogueIndex: z.number().int().min(0).max(3),
    suggestions: z.array(roleSkillProfileSuggestionSchema).max(12),
    profileChange: roleSkillProfileChangeSchema.optional(),
    cases: z.array(roleSkillRunCaseSchema).max(3),
    skills: z.array(roleSkillRunSkillSchema).min(1).max(5),
    currentCaseIndex: z.number().int().min(0).max(3),
    readiness: z
      .object({
        ready: z.boolean(),
        confirmedCount: z.number().int().min(0).max(5),
        missingKeySkillIds: z.array(z.string().min(1).max(160)).max(5),
      })
      .strict(),
    modelError: z
      .object({
        action: z.enum(['suggestions', 'evaluation', 'discussion', 'appeal']),
        code: z.string().trim().min(1).max(80),
        caseId: z.string().trim().min(1).max(240).nullable(),
      })
      .strict()
      .nullable(),
    lastRequest: roleAssessmentRequestSchema.nullable(),
    /** B552: a check started from a vacancy's consultant offer. */
    focus: z
      .object({
        vacancyId: z.string().trim().min(1).max(200),
        vacancyTitle: z.string().trim().min(1).max(500),
        skills: z.array(z.string().trim().min(1).max(200)).min(1).max(3),
        sampleRoleTitle: z.string().trim().min(1).max(200),
        roleNote: z.string().trim().min(1).max(500).nullable(),
        lackingNotes: z.array(z.string().trim().min(1).max(500)).max(3),
      })
      .strict()
      .optional(),
  })
  .strict();

export type RoleSkillProfileSuggestion = z.infer<typeof roleSkillProfileSuggestionSchema>;
export type RoleSkillAssessmentRun = z.infer<typeof roleSkillAssessmentRunSchema>;

export function parseRoleSkillAssessmentRun(value: unknown): RoleSkillAssessmentRun {
  return roleSkillAssessmentRunSchema.parse(value);
}

/** Counts one active, fresh vacancy once, even when it has duplicate requirements. */
export function countFreshActiveRoleVacancies(
  vacancies: readonly RoleAssessmentVacancy[],
  roleId: string,
): number {
  return new Set(
    vacancies
      .filter(
        (vacancy) =>
          vacancy.roleId === roleId && vacancy.status === 'active' && vacancy.freshness === 'fresh',
      )
      .map((vacancy) => vacancy.id),
  ).size;
}

/**
 * Returns up to three case prompts from requirements repeated across a role's
 * fresh, active vacancy sample. A requirement is usable only with dated source
 * refs that point back to vacancies in that sample.
 */
export function buildRoleSkillCases(
  vacancies: readonly RoleAssessmentVacancy[],
  roleId: string,
): RoleSkillCase[] {
  return buildRoleSkillRequirementSummaries(vacancies, roleId)
    .slice(0, 3)
    .map((requirement, index) => toCase(requirement, roleId, index));
}

/** Five common requirements from the dated vacancy sample, ordered by frequency. */
export function buildRoleSkillRequirementSummaries(
  vacancies: readonly RoleAssessmentVacancy[],
  roleId: string,
): RoleSkillRequirementSummary[] {
  const eligibleVacancies = uniqueEligibleVacancies(vacancies, roleId);
  if (eligibleVacancies.length < MIN_ROLE_SAMPLE) return [];

  const requirements = aggregateRequirements(eligibleVacancies);
  // B509: most vacancies have no extracted requirements yet, so repetition is a share of
  // the vacancies that do; a share of all of them made the check unreachable.
  const withRequirements = eligibleVacancies.filter((vacancy) => vacancy.requirements.length > 0);
  const repeatedThreshold = Math.max(
    MIN_REPEATED_VACANCIES,
    Math.ceil(withRequirements.length * REPEATED_SHARE),
  );
  return [...requirements.values()]
    .filter((item) => item.vacancyIds.size >= repeatedThreshold)
    .sort(
      (left, right) =>
        right.vacancyIds.size - left.vacancyIds.size || left.skillId.localeCompare(right.skillId),
    )
    .slice(0, 5)
    .map((item, index) => ({
      requirementId: item.representativeId,
      skillId: item.skillId,
      name: item.statement,
      vacancyCount: item.vacancyIds.size,
      isKeySkill: index < 2,
      sourceRefs: [...item.sourceRefs.values()]
        .sort(
          (left, right) =>
            right.observedAt.localeCompare(left.observedAt) || left.id.localeCompare(right.id),
        )
        .slice(0, 20),
    }));
}

function uniqueEligibleVacancies(
  vacancies: readonly RoleAssessmentVacancy[],
  roleId: string,
): RoleAssessmentVacancy[] {
  const seen = new Set<string>();
  return vacancies.filter((vacancy) => {
    if (
      vacancy.roleId !== roleId ||
      vacancy.status !== 'active' ||
      vacancy.freshness !== 'fresh' ||
      seen.has(vacancy.id)
    ) {
      return false;
    }
    seen.add(vacancy.id);
    return true;
  });
}

interface AggregatedRequirement {
  skillId: string;
  statement: string;
  representativeId: string;
  vacancyIds: Set<string>;
  sourceRefs: Map<string, RoleSkillSourceRef>;
}

function aggregateRequirements(
  vacancies: readonly RoleAssessmentVacancy[],
): Map<string, AggregatedRequirement> {
  const bySkill = new Map<string, AggregatedRequirement>();
  const validVacancyIds = new Set(vacancies.map((vacancy) => vacancy.id));
  for (const vacancy of vacancies) {
    for (const requirement of vacancy.requirements) {
      const statement = requirement.statement.trim();
      const skillId = requirement.skillId.trim();
      if (!statement || !skillId) continue;
      const refs = validSourceRefs(requirement.sourceRefs, vacancy.id, validVacancyIds);
      if (refs.length === 0) continue;

      const entry = bySkill.get(skillId) ?? {
        skillId,
        statement,
        representativeId: requirement.id,
        vacancyIds: new Set<string>(),
        sourceRefs: new Map<string, RoleSkillSourceRef>(),
      };
      entry.vacancyIds.add(vacancy.id);
      for (const ref of refs) entry.sourceRefs.set(ref.id, ref);
      if (statement.localeCompare(entry.statement) < 0) {
        entry.statement = statement;
        entry.representativeId = requirement.id;
      }
      bySkill.set(skillId, entry);
    }
  }
  return bySkill;
}

function validSourceRefs(
  refs: readonly RoleSkillSourceRef[],
  currentVacancyId: string,
  validVacancyIds: ReadonlySet<string>,
): RoleSkillSourceRef[] {
  const valid: RoleSkillSourceRef[] = [];
  for (const ref of refs) {
    const parsed = sourceRefSchema.safeParse(ref);
    if (
      parsed.success &&
      parsed.data.vacancyId === currentVacancyId &&
      validVacancyIds.has(parsed.data.vacancyId)
    ) {
      valid.push(parsed.data);
    }
  }
  return valid;
}

function toCase(
  requirement: RoleSkillRequirementSummary,
  roleId: string,
  index: number,
): RoleSkillCase {
  return {
    id: `role-case-${index + 1}-${requirement.skillId}`,
    roleId,
    requirementId: requirement.requirementId,
    skillId: requirement.skillId,
    skillName: requirement.name,
    prompt: `Расскажите о практической ситуации, в которой вы применяли требование «${requirement.name}». Как вы выбрали действия, учли риски и проверили результат?`,
    requirementsCount: requirement.vacancyCount,
    sourceRefs: requirement.sourceRefs,
  };
}

/** Validates model grades, exact answer excerpts, complete criteria and source lineage. */
export function validateRoleSkillEvaluation(input: {
  candidateAnswer: string;
  criteria: readonly RoleSkillCriterion[];
  allowedSourceRefs: readonly RoleSkillSourceRef[];
  modelEvaluation: unknown;
}): RoleSkillEvaluation {
  const answer = input.candidateAnswer.trim();
  if (!answer || answer.length > 10_000) throw new Error('candidate_answer_invalid');
  const evaluation = roleSkillModelEvaluationSchema.parse(input.modelEvaluation);
  const criterionIds = uniqueIds(input.criteria.map((criterion) => criterion.id));
  const allowedSourceIds = new Set(
    input.allowedSourceRefs.map((source) => sourceRefSchema.parse(source).id),
  );
  const modelIds = uniqueIds(evaluation.criteria.map((criterion) => criterion.criterionId));
  if (criterionIds.length !== evaluation.criteria.length || !sameIds(criterionIds, modelIds)) {
    throw new Error('evaluation_criteria_mismatch');
  }

  const criteria = evaluation.criteria.map((criterion) => {
    if (!answer.includes(criterion.candidateExcerpt)) {
      throw new Error('evaluation_quote_not_in_answer');
    }
    if (criterion.sourceRefIds.some((sourceId) => !allowedSourceIds.has(sourceId))) {
      throw new Error('evaluation_source_not_allowed');
    }
    return { ...criterion, sourceRefIds: [...new Set(criterion.sourceRefIds)] };
  });
  const gradeFromCriteria = aggregateGrade(criteria.map((criterion) => criterion.grade));
  if (evaluation.grade !== gradeFromCriteria) throw new Error('evaluation_grade_mismatch');
  return { candidateAnswer: answer, grade: evaluation.grade, criteria };
}

function aggregateGrade(grades: readonly RoleSkillGrade[]): RoleSkillGrade {
  if (grades.every((grade) => grade === 'confirmed')) return 'confirmed';
  if (grades.every((grade) => grade === 'not_confirmed')) return 'not_confirmed';
  return 'partial';
}

function uniqueIds(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id) => right.includes(id));
}

export function isRoleSkillAssessmentStale(assessedAt: string, now: string): boolean {
  const assessedMs = Date.parse(assessedAt);
  const nowMs = Date.parse(now);
  if (!Number.isFinite(assessedMs) || !Number.isFinite(nowMs) || nowMs < assessedMs) return true;
  return nowMs - assessedMs >= 90 * 24 * 60 * 60 * 1_000;
}

export function evaluateRoleReadiness(skills: readonly RoleSkillReadinessSkill[]): {
  readonly ready: boolean;
  readonly confirmedCount: number;
  readonly missingKeySkillIds: string[];
} {
  const confirmedCount = skills.filter((skill) => skill.grade === 'confirmed').length;
  const missingKeySkillIds = skills
    .filter((skill) => skill.isKeySkill && skill.grade !== 'confirmed')
    .map((skill) => skill.id);
  return {
    ready: skills.length === 5 && confirmedCount >= 3 && missingKeySkillIds.length === 0,
    confirmedCount,
    missingKeySkillIds,
  };
}
