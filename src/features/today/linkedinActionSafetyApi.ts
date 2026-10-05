import { apiFetch, readData, throwApiError } from '../coach/apiClient';

export type LinkedinSafetyStopReason =
  | 'challenge_required'
  | 'platform_restricted'
  | 'unexpected_page'
  | 'provider_error'
  | 'manual_pause'
  | 'platform_pause';

export interface LinkedinActionSafetyStatus {
  readonly paused: boolean;
  readonly reason: LinkedinSafetyStopReason | null;
  readonly canResume: boolean;
  readonly updatedAt: string | null;
}

interface LinkedinActionSafetyResponse {
  readonly linkedinSafetyStop: LinkedinActionSafetyStatus;
}

async function readSafetyStatus(response: Response): Promise<LinkedinActionSafetyStatus> {
  if (!response.ok) await throwApiError(response);
  const data = await readData<LinkedinActionSafetyResponse>(response);
  return data.linkedinSafetyStop;
}

export async function getLinkedinActionSafetyStatus(): Promise<LinkedinActionSafetyStatus> {
  return readSafetyStatus(await apiFetch('/api/v1/candidate/actions/usage'));
}

export async function resumeLinkedinActions(): Promise<LinkedinActionSafetyStatus> {
  return readSafetyStatus(await apiFetch('/api/v1/candidate/actions/kill-switch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ active: false, platform: 'linkedin' }),
  }));
}
