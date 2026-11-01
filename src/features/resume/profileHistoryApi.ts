import { apiFetch, malformedResponseError, readData, readDataObject } from '../coach/apiClient';

export type ProfileHistoryActor = 'candidate' | 'consultant' | 'import' | 'skill_check';

export interface ProfileHistoryItem {
  readonly id: string;
  readonly actor: ProfileHistoryActor;
  readonly section: string;
  readonly kind: 'value' | 'confirmation';
  readonly itemId: string | null;
  readonly label: string;
  readonly previousText: string;
  readonly appliedText: string;
  readonly createdAt: string;
  readonly revertedAt: string | null;
}

export interface ProfileHistoryPage {
  readonly entries: readonly ProfileHistoryItem[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
}

export async function getProfileHistory(
  page: number,
  signal?: AbortSignal,
): Promise<ProfileHistoryPage> {
  const response = await apiFetch(`/api/v1/candidate/profile/history?page=${page}`, { signal });
  const data = await readDataObject<ProfileHistoryPage>(response);
  if (!Array.isArray(data.entries)) throw malformedResponseError();
  return data;
}

export async function revertProfileHistoryEntry(changeId: string): Promise<void> {
  const response = await apiFetch(
    `/api/v1/candidate/profile/history/${encodeURIComponent(changeId)}/revert`,
    { method: 'POST' },
  );
  await readData<{ reverted: true }>(response);
}

export async function confirmProfileExperience(experienceId: string): Promise<void> {
  const response = await apiFetch(
    `/api/v1/candidate/profile/experience/${encodeURIComponent(experienceId)}/confirm`,
    { method: 'POST' },
  );
  await readData<{ confirmed: true }>(response);
}
