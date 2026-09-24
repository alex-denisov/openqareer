import type { ApplicationView } from '../../../server/domain/applicationDerivedFields';
import type { ApplicationStage } from '../../../shared/applicationStage';
import type { SkipReasonId } from '../../../shared/skipReasons';
import { apiFetch, readDataArray, readDataObject } from '../coach/apiClient';

export type { ApplicationView } from '../../../server/domain/applicationDerivedFields';

/** `code` on a `CoachApiError` thrown by `patchApplication` (server/routes/runtime.ts). */
export const APPLICATION_VERSION_CONFLICT_CODE = 'application_version_conflict';

export interface ManualVacancyInput {
  readonly title: string;
  readonly company?: string;
  readonly companyHidden?: boolean;
  readonly source: 'recruiter' | 'other';
  readonly url?: string;
}

export interface CreateApplicationInput {
  readonly clusterId?: string;
  readonly manualVacancy?: ManualVacancyInput;
  readonly stage: ApplicationStage;
  readonly occurredAt?: string;
}

export interface PatchApplicationInput {
  readonly expectedVersion: number;
  readonly stage?: ApplicationStage;
  readonly occurredAt?: string;
  readonly notes?: string | null;
  readonly followUpDueAt?: string | null;
}

/** Minutes east of UTC, the shape `?tz=` and `shared/followUpPolicy` expect. */
export function localTimezoneOffsetMinutes(): number {
  return -new Date().getTimezoneOffset();
}

export async function listApplications(signal?: AbortSignal): Promise<ApplicationView[]> {
  const tz = localTimezoneOffsetMinutes();
  const response = await apiFetch(`/api/v1/candidate/applications?tz=${tz}`, { signal });
  return readDataArray<ApplicationView>(response);
}

export async function createApplication(input: CreateApplicationInput): Promise<ApplicationView> {
  const response = await apiFetch('/api/v1/candidate/applications', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return readDataObject<ApplicationView>(response);
}

export async function patchApplication(
  id: string,
  input: PatchApplicationInput,
): Promise<ApplicationView> {
  const response = await apiFetch(`/api/v1/candidate/applications/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return readDataObject<ApplicationView>(response);
}

export interface CreatedVacancySkip {
  readonly candidateId: string;
  readonly clusterId: string;
  readonly reasonId: SkipReasonId;
}

export async function createVacancySkip(input: {
  readonly clusterId: string;
  readonly reasonId: SkipReasonId;
  readonly origin: 'vacancy_card' | 'kanban';
}): Promise<CreatedVacancySkip> {
  const response = await apiFetch('/api/v1/candidate/vacancy-skips', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return readDataObject<CreatedVacancySkip>(response);
}

export type ApplicationFunnel = Record<ApplicationStage, number> & { opened: number };

export async function getApplicationFunnel(signal?: AbortSignal): Promise<ApplicationFunnel> {
  const response = await apiFetch('/api/v1/candidate/applications/funnel', { signal });
  return readDataObject<ApplicationFunnel>(response);
}
