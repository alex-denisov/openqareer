import { sharedRead, untilAborted } from './sharedRead';
import { apiFetch, malformedResponseError, readData, readDataObject } from '../coach/apiClient';
import type { ResumeAtsAssessment } from '../../../server/domain/resumeAtsAssessment';
import type {
  ResumeVersionSummary,
  StoredResumeVersion,
} from '../../../server/domain/resumeVersions';

export interface ResumeVersionList {
  readonly items: readonly ResumeVersionSummary[];
  readonly nextCursor: string | null;
  readonly totalCount: number;
  readonly currentMasterRevision: string;
}

export interface ResumeVersionResource {
  readonly version: StoredResumeVersion;
  readonly currentMasterRevision: string;
}

export interface ResumeVersionCreateInput {
  readonly title: string;
  readonly requirements: readonly string[];
  readonly expectedMasterRevision: string;
}

export interface ResumeVersionUpdateInput extends ResumeVersionCreateInput {
  readonly expectedRevision: number;
  readonly status?: 'approved';
}

export interface ResumeAtsAssessmentRequest {
  readonly title?: string;
  readonly requirements?: readonly string[];
  readonly versionId?: string;
}

export async function getResumeVersions(
  input: {
    readonly limit?: number;
    readonly cursor?: string | null;
    readonly signal?: AbortSignal;
  } = {},
): Promise<ResumeVersionList> {
  const query = new URLSearchParams({
    limit: String(input.limit ?? 20),
    ...(input.cursor ? { cursor: input.cursor } : {}),
  });
  const path = '/api/v1/candidate/resume/versions?' + query.toString();
  const read = sharedRead(path, async () => {
    // An empty or malformed page must reach the caller's error state, not crash the cabinet
    // inside a state updater that reads `items`.
    const list = await readDataObject<ResumeVersionList>(await apiFetch(path));
    if (!Array.isArray(list.items)) throw malformedResponseError();
    return list;
  });
  return untilAborted(read, input.signal);
}

export async function createResumeVersion(
  input: ResumeVersionCreateInput,
  idempotencyKey: string,
): Promise<ResumeVersionResource> {
  const response = await apiFetch('/api/v1/candidate/resume/versions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify(input),
  });
  return readData<ResumeVersionResource>(response);
}

export async function getResumeVersion(
  versionId: string,
  signal?: AbortSignal,
): Promise<ResumeVersionResource> {
  const response = await apiFetch(
    '/api/v1/candidate/resume/versions/' + encodeURIComponent(versionId),
    { signal },
  );
  return readData<ResumeVersionResource>(response);
}

export async function updateResumeVersion(
  versionId: string,
  input: ResumeVersionUpdateInput,
): Promise<ResumeVersionResource> {
  const response = await apiFetch(
    '/api/v1/candidate/resume/versions/' + encodeURIComponent(versionId),
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  );
  return readData<ResumeVersionResource>(response);
}

export async function getResumeAtsAssessment(
  input: ResumeAtsAssessmentRequest,
  signal?: AbortSignal,
): Promise<ResumeAtsAssessment> {
  return (await postAtsAssessment(input, signal)).assessment;
}

/** Версия или роль, по которой сервер посчитал оценку, когда кандидат её не выбрал. */
export interface ResumeAtsBasis {
  readonly version: ResumeVersionSummary | null;
  readonly roleTitle: string | null;
}

export interface ProfileAtsAssessmentResult {
  readonly assessment: ResumeAtsAssessment;
  readonly basis: ResumeAtsBasis;
}

/**
 * Открытие «Профиля»: пустое тело — версию и роль выбирает сервер по правилу
 * `shared/atsBasis`, и карточка получает оценку одним запросом.
 */
export function getProfileAtsAssessment(signal?: AbortSignal): Promise<ProfileAtsAssessmentResult> {
  return postAtsAssessment({}, signal);
}

async function postAtsAssessment(
  input: ResumeAtsAssessmentRequest,
  signal?: AbortSignal,
): Promise<ProfileAtsAssessmentResult> {
  const response = await apiFetch('/api/v1/candidate/resume/ats-assessment', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    signal,
  });
  const result = await readData<{
    assessment?: ResumeAtsAssessment | null;
    basis?: Partial<ResumeAtsBasis> | null;
  } | null>(response);
  const assessment = result?.assessment;
  if (!assessment || typeof assessment !== 'object') throw malformedResponseError();
  return {
    assessment,
    basis: {
      version: result?.basis?.version ?? null,
      roleTitle: result?.basis?.roleTitle ?? null,
    },
  };
}
