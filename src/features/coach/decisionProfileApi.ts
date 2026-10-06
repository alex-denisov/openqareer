import { apiFetch, readData } from './apiClient';
import type { CandidateDecisionProfile } from '../../../shared/workPreferences';

/** Профиль ограничений на сервере (B384): жёсткие фильтры подборки считает сервер. */
export async function getDecisionProfile(
  signal?: AbortSignal,
): Promise<CandidateDecisionProfile | null> {
  const response = await apiFetch('/api/v1/candidate/decision-profile', signal ? { signal } : {});
  return readData<CandidateDecisionProfile | null>(response);
}

export async function putDecisionProfile(
  profile: CandidateDecisionProfile,
  signal?: AbortSignal,
): Promise<void> {
  const { updatedAt: _updatedAt, ...body } = profile;
  const response = await apiFetch('/api/v1/candidate/decision-profile', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) throw new Error('decision profile was not saved');
}
