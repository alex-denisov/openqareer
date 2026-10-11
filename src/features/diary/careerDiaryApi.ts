import {
  type CareerDiaryAchievement,
  type CareerDiaryAchievementInput,
  type CareerDiaryAchievementStatus,
  type CareerDiaryGoalInput,
  type CareerDiaryGoalSummary,
  type CareerDiaryMeasurement,
  type CareerDiaryMeasurementInput,
  type CareerDiaryOverview,
  type CareerDiaryPage,
  type CareerDiaryWeeklyReview,
  type CareerDiaryWeeklyReviewInput,
} from '../../../shared/careerDiary';
import type {
  CareerDiaryGoalPatchWithQuarterDecision,
  CareerDiaryGoalWithQuarterDecision,
  CareerDiaryWorkplacePatchWithPlanning,
  CareerDiaryWorkplaceWithPlanning,
} from './careerDiaryPlanning';
import { apiFetch, readData } from '../coach/apiClient';

const API_ROOT = '/api/v1/candidate/career-diary';

async function readResponse<T>(path: string, init?: RequestInit): Promise<T> {
  return readData<T>(await apiFetch(path, init));
}

function jsonMutation(method: 'PATCH' | 'POST' | 'PUT', body: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function idempotentMutation(body: unknown): RequestInit {
  return {
    ...jsonMutation('POST', body),
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': crypto.randomUUID(),
    },
  };
}

function pagePath(collection: string, limit: number, cursor?: string): string {
  const query = new URLSearchParams({ limit: String(limit) });
  if (cursor) query.set('cursor', cursor);
  return `${API_ROOT}/${collection}?${query.toString()}`;
}

export function getCareerDiaryOverview(signal?: AbortSignal): Promise<CareerDiaryOverview> {
  return readResponse(API_ROOT, { signal });
}

export function getCareerDiaryWorkplace(
  workplaceId: string,
  signal?: AbortSignal,
): Promise<CareerDiaryWorkplaceWithPlanning> {
  return readResponse(
    `${API_ROOT}/workplaces/${encodeURIComponent(workplaceId)}`,
    { signal },
  );
}

export function updateCareerDiaryWorkplace(
  workplaceId: string,
  patch: CareerDiaryWorkplacePatchWithPlanning,
): Promise<CareerDiaryWorkplaceWithPlanning> {
  return readResponse(
    `${API_ROOT}/workplaces/${encodeURIComponent(workplaceId)}`,
    jsonMutation('PATCH', patch),
  );
}

export function listCareerDiaryGoals(input: {
  limit: number;
  cursor?: string;
  signal?: AbortSignal;
}): Promise<CareerDiaryPage<CareerDiaryGoalWithQuarterDecision>> {
  return readResponse(pagePath('goals', input.limit, input.cursor), { signal: input.signal });
}

export function getCareerDiaryGoal(
  goalId: string,
  signal?: AbortSignal,
): Promise<CareerDiaryGoalWithQuarterDecision> {
  return readResponse(`${API_ROOT}/goals/${encodeURIComponent(goalId)}`, { signal });
}

export function createCareerDiaryGoal(input: CareerDiaryGoalInput): Promise<CareerDiaryGoalSummary> {
  return readResponse(`${API_ROOT}/goals`, idempotentMutation(input));
}

export function updateCareerDiaryGoal(
  goalId: string,
  patch: CareerDiaryGoalPatchWithQuarterDecision,
): Promise<CareerDiaryGoalWithQuarterDecision> {
  return readResponse(
    `${API_ROOT}/goals/${encodeURIComponent(goalId)}`,
    jsonMutation('PATCH', patch),
  );
}

export function deleteCareerDiaryGoal(goalId: string): Promise<{ readonly deleted: boolean }> {
  return readResponse(`${API_ROOT}/goals/${encodeURIComponent(goalId)}`, { method: 'DELETE' });
}

export function listCareerDiaryMeasurements(
  goalId: string,
  input: { limit: number; cursor?: string; signal?: AbortSignal },
): Promise<CareerDiaryPage<CareerDiaryMeasurement>> {
  const path = pagePath(`goals/${encodeURIComponent(goalId)}/measurements`, input.limit, input.cursor);
  return readResponse(path, { signal: input.signal });
}

export function recordCareerDiaryMeasurement(
  goalId: string,
  input: CareerDiaryMeasurementInput,
): Promise<CareerDiaryMeasurement> {
  return readResponse(
    `${API_ROOT}/goals/${encodeURIComponent(goalId)}/measurements`,
    idempotentMutation(input),
  );
}

export function listCareerDiaryReviews(input: {
  limit: number;
  cursor?: string;
  signal?: AbortSignal;
}): Promise<CareerDiaryPage<CareerDiaryWeeklyReview>> {
  return readResponse(pagePath('reviews', input.limit, input.cursor), { signal: input.signal });
}

export function listCareerDiaryAchievements(input: {
  limit: number;
  cursor?: string;
  signal?: AbortSignal;
}): Promise<CareerDiaryPage<CareerDiaryAchievement>> {
  return readResponse(pagePath('achievements', input.limit, input.cursor), {
    signal: input.signal,
  });
}

export function upsertCareerDiaryReview(
  weekStart: string,
  input: CareerDiaryWeeklyReviewInput,
): Promise<CareerDiaryWeeklyReview> {
  return readResponse(
    `${API_ROOT}/reviews/${encodeURIComponent(weekStart)}`,
    jsonMutation('PUT', input),
  );
}

export function createCareerDiaryAchievement(
  input: CareerDiaryAchievementInput,
): Promise<CareerDiaryAchievement> {
  return readResponse(`${API_ROOT}/achievements`, idempotentMutation(input));
}

export function setCareerDiaryAchievementStatus(
  achievementId: string,
  status: CareerDiaryAchievementStatus,
): Promise<CareerDiaryAchievement> {
  return readResponse(
    `${API_ROOT}/achievements/${encodeURIComponent(achievementId)}`,
    jsonMutation('PATCH', { status }),
  );
}
