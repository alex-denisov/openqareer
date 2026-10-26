import type { WorkFamilyCode, WorkPreferenceAnswer } from '../../../shared/workPreferences';
import { apiFetch, readDataObject } from './apiClient';
import type { WorkPreferencesRead } from './coachApi';

export async function getWorkPreferences(signal?: AbortSignal): Promise<WorkPreferencesRead> {
  const response = await apiFetch('/api/v1/candidate/work-preferences', { signal });
  return readDataObject<WorkPreferencesRead>(response);
}

export async function submitWorkPreferences(input: {
  readonly answers: readonly WorkPreferenceAnswer[];
  readonly excluded: readonly WorkFamilyCode[];
}): Promise<NonNullable<WorkPreferencesRead['run']>> {
  const response = await apiFetch('/api/v1/candidate/work-preferences', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return readDataObject<NonNullable<WorkPreferencesRead['run']>>(response);
}
