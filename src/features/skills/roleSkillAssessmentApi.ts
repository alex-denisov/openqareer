import {
  apiFetch,
  malformedResponseError,
  readDataObject,
  throwApiError,
} from '../coach/apiClient';
import type { RoleSkillAssessmentRun } from '../../../server/domain/roleSkillAssessment';

export type RoleSkillAssessmentCurrent =
  | { state: 'role_not_selected' }
  | { state: 'source_unavailable' }
  | { state: 'too_few_vacancies'; roleTitle: string; sampleSize: number; threshold: number }
  | {
      state: 'insufficient_requirements';
      roleTitle: string;
      sampleSize: number;
      requirementCount: number;
      /** B509: requirements of the role's vacancies are still being extracted. */
      collecting?: boolean;
    }
  | {
      state: 'ready';
      roleTitle: string;
      roleVersion: number;
      sampleSize: number;
      evidenceObservedAt: string;
      skills: Array<{
        skillId: string;
        name: string;
        vacancyCount: number;
        isKeySkill: boolean;
        sourceRefs: Array<{
          id: string;
          vacancyId: string;
          observedAt: string;
          sourceName?: string;
        }>;
      }>;
      cases: RoleSkillAssessmentRun['cases'][number]['assessmentCase'][];
    }
  | { state: 'focus_insufficient'; roleTitle: string; skills: string[]; notes: string[] }
  | { state: 'role_changed'; run: RoleSkillAssessmentRun }
  | { state: 'run'; run: RoleSkillAssessmentRun }
  | { state: 'result'; run: RoleSkillAssessmentRun; stale?: boolean };

export interface RoleSkillAssessmentMutationResult {
  state: 'run' | 'result';
  run: RoleSkillAssessmentRun;
}

/** Без роли — проверка роли «Стратегии»; с ролью — роли, нажатой на «Карьере» (B445). */
export async function getCurrentRoleSkillAssessment(
  roleTitle?: string,
): Promise<RoleSkillAssessmentCurrent> {
  const query = roleTitle ? `?role=${encodeURIComponent(roleTitle)}` : '';
  const response = await apiFetch(`/api/v1/candidate/role-skill-assessments/current${query}`);
  return readDataObject<RoleSkillAssessmentCurrent>(response);
}

/** B552: a check limited to these skills of one vacancy. */
export interface RoleSkillAssessmentFocusRequest {
  vacancyId: string;
  skills: readonly string[];
}

export async function startRoleSkillAssessment(
  roleTitle?: string,
  focus?: RoleSkillAssessmentFocusRequest,
): Promise<RoleSkillAssessmentCurrent> {
  return post('/api/v1/candidate/role-skill-assessments/start', {
    consent: true,
    ...(roleTitle ? { role: roleTitle } : {}),
    ...(focus ? { focus: { vacancyId: focus.vacancyId, skills: [...focus.skills] } } : {}),
  });
}

export interface CheckedRole {
  readonly roleTitle: string;
  readonly completedAt: string;
}

/** Роли с завершённой проверкой навыков (B445). */
export async function getCheckedRoles(signal?: AbortSignal): Promise<readonly CheckedRole[]> {
  const response = await apiFetch('/api/v1/candidate/role-skill-assessments/checked-roles', {
    signal,
  });
  if (!response.ok) await throwApiError(response);
  const envelope = (await response.json()) as { data?: unknown };
  if (!Array.isArray(envelope.data)) throw malformedResponseError();
  return envelope.data as CheckedRole[];
}

export async function answerRoleAssessmentDialogue(input: {
  runId: string;
  expectedRevision: number;
  requestId: string;
  answer: string;
}): Promise<RoleSkillAssessmentMutationResult> {
  const { runId, ...body } = input;
  return post(`${base(runId)}/dialogue`, body);
}

export async function decideRoleAssessmentSuggestions(input: {
  runId: string;
  expectedRevision: number;
  requestId: string;
  suggestions: Array<{ id: string; accepted: boolean; statement: string }>;
}): Promise<RoleSkillAssessmentMutationResult> {
  const { runId, ...body } = input;
  return post(`${base(runId)}/suggestions`, body);
}

export async function rollbackRoleAssessmentSuggestions(input: {
  runId: string;
  expectedRevision: number;
  requestId: string;
}): Promise<RoleSkillAssessmentMutationResult> {
  const { runId, ...body } = input;
  return post(`${base(runId)}/suggestions/rollback`, body);
}

export async function saveRoleAssessmentDraft(input: {
  runId: string;
  caseId: string;
  expectedRevision: number;
  requestId: string;
  draft: string;
}): Promise<RoleSkillAssessmentMutationResult> {
  const { runId, caseId, ...body } = input;
  return post(`${base(runId)}/cases/${encodeURIComponent(caseId)}/draft`, body);
}

export async function answerRoleAssessmentCase(input: {
  runId: string;
  caseId: string;
  expectedRevision: number;
  requestId: string;
  answer: string;
}): Promise<RoleSkillAssessmentMutationResult> {
  const { runId, caseId, ...body } = input;
  return post(`${base(runId)}/cases/${encodeURIComponent(caseId)}/answer`, body);
}

export async function skipRoleAssessmentCase(input: {
  runId: string;
  caseId: string;
  expectedRevision: number;
  requestId: string;
}): Promise<RoleSkillAssessmentMutationResult> {
  const { runId, caseId, ...body } = input;
  return post(`${base(runId)}/cases/${encodeURIComponent(caseId)}/skip`, body);
}

export async function discussRoleAssessmentCase(input: {
  runId: string;
  caseId: string;
  expectedRevision: number;
  requestId: string;
  question: string;
}): Promise<RoleSkillAssessmentMutationResult> {
  const { runId, caseId, ...body } = input;
  return post(`${base(runId)}/cases/${encodeURIComponent(caseId)}/discuss`, body);
}

export async function appealRoleAssessmentCase(input: {
  runId: string;
  caseId: string;
  expectedRevision: number;
  requestId: string;
  reason: string;
}): Promise<RoleSkillAssessmentMutationResult> {
  const { runId, caseId, ...body } = input;
  return post(`${base(runId)}/cases/${encodeURIComponent(caseId)}/appeal`, body);
}

export async function retryRoleSkillAssessment(input: {
  runId: string;
  expectedRevision: number;
  requestId: string;
}): Promise<RoleSkillAssessmentMutationResult> {
  const { runId, ...body } = input;
  return post(`${base(runId)}/retry`, body);
}

function base(runId: string): string {
  return `/api/v1/candidate/role-skill-assessments/${encodeURIComponent(runId)}`;
}

async function post<T extends object>(path: string, body: unknown): Promise<T> {
  const response = await apiFetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return readDataObject<T>(response);
}
