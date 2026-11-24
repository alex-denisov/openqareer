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
  readonly details?: readonly string[];
  readonly createdAt: string;
  readonly revertedAt: string | null;
}

/** Отбор по источнику правки (p10). */
export type ProfileHistorySource = 'candidate' | 'consultant';
export type ProfileHistorySources = Readonly<Record<'all' | ProfileHistorySource, number>>;

export interface ProfileHistoryPage {
  readonly entries: readonly ProfileHistoryItem[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
  /** Счёт по источникам; до обновления сервера поля нет. */
  readonly sources?: ProfileHistorySources;
}

export async function getProfileHistory(
  page: number,
  signal?: AbortSignal,
  source?: ProfileHistorySource,
): Promise<ProfileHistoryPage> {
  const filter = source ? `&source=${source}` : '';
  const response = await apiFetch(`/api/v1/candidate/profile/history?page=${page}${filter}`, {
    signal,
  });
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
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    },
  );
  await readData<{ confirmed: true }>(response);
}
