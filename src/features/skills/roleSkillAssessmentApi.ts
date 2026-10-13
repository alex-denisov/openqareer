import { apiFetch, readDataObject } from '../coach/apiClient';
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
  | { state: 'role_changed'; run: RoleSkillAssessmentRun }
  | { state: 'run'; run: RoleSkillAssessmentRun }
  | { state: 'result'; run: RoleSkillAssessmentRun; stale?: boolean };

export interface RoleSkillAssessmentMutationResult {
  state: 'run' | 'result';
  run: RoleSkillAssessmentRun;
}

export async function getCurrentRoleSkillAssessment(): Promise<RoleSkillAssessmentCurrent> {
  const response = await apiFetch('/api/v1/candidate/role-skill-assessments/current');
  return readDataObject<RoleSkillAssessmentCurrent>(response);
}

export async function startRoleSkillAssessment(): Promise<RoleSkillAssessmentCurrent> {
  return post('/api/v1/candidate/role-skill-assessments/start', { consent: true });
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
