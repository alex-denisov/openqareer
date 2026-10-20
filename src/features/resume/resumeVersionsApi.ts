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
  const response = await apiFetch('/api/v1/candidate/resume/versions?' + query.toString(), {
    signal: input.signal,
  });
  // An empty or malformed page must reach the caller's error state, not crash the cabinet
  // inside a state updater that reads `items`.
  const list = await readDataObject<ResumeVersionList>(response);
  if (!Array.isArray(list.items)) throw malformedResponseError();
  return list;
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
  const response = await apiFetch('/api/v1/candidate/resume/ats-assessment', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    signal,
  });
  const result = await readData<{ assessment?: ResumeAtsAssessment | null } | null>(response);
  const assessment = result?.assessment;
  if (!assessment || typeof assessment !== 'object') throw malformedResponseError();
  return assessment;
}
