import { apiFetch, readData } from '../../../coach/apiClient';
import { DraftApiError } from '../../../today/linkedinDraftApi';
import type {
  FeedApproveResponse,
  FeedPostCreated,
  FeedPostPage,
} from '../../../../../shared/b640FeedComments';
import type {
  LinkedinQueueItem,
  LinkedinQueuePage,
  LinkedinRhythm,
} from '../../../../../shared/b640LinkedinQueue';

const BASE = '/api/v1/candidate/b640/linkedin';

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(url, init);
  try {
    return await readData<T>(response);
  } catch (error) {
    if (response.ok) throw error;
    throw new DraftApiError(
      response.status,
      error instanceof Error ? error.message : 'Не удалось завершить действие',
      error instanceof Error && 'code' in error && typeof error.code === 'string'
        ? error.code
        : undefined,
    );
  }
}

const post = (body: unknown) =>
  ({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) satisfies RequestInit;

export const getRhythm = () => request<LinkedinRhythm>(`${BASE}/rhythm`);

export const listQueue = (limit = 20) => request<LinkedinQueuePage>(`${BASE}/queue?limit=${limit}`);

const queueTotal = (state: 'queued' | 'due') =>
  request<LinkedinQueuePage>(`${BASE}/queue?state=${state}&limit=1`).then((page) => page.total);

/** B695: сколько постов ждёт в очереди LinkedIn (по расписанию и уже пора) — их тоже останавливает n05. */
export const countScheduledPosts = async (): Promise<number> => {
  const [queued, due] = await Promise.all([queueTotal('queued'), queueTotal('due')]);
  return queued + due;
};

/** Одобренный черновик встаёт в первый свободный слот ритма; на LinkedIn ничего не уходит. */
export const enqueueDraft = (draftId: string) =>
  request<{ readonly scheduledAt: string }>(`${BASE}/queue`, post({ draftId }));

export const listFeedPosts = (limit = 20) =>
  request<FeedPostPage>(`${BASE}/feed-posts?limit=${limit}`);

export const createFeedPost = (input: { readonly url?: string; readonly text: string }) =>
  request<FeedPostCreated>(`${BASE}/feed-posts`, post(input));

export const approveFeedPosts = (draftIds: readonly string[]) =>
  request<FeedApproveResponse>(`${BASE}/feed-posts/approve`, post({ draftIds }));

/** a05e: ритм сохраняется на сервере, комментарии очереди встают на его слоты. */
export const saveRhythm = (rhythm: LinkedinRhythm) =>
  request<LinkedinRhythm>(`${BASE}/rhythm`, { ...post(rhythm), method: 'PUT' });

/** a05b «Перенести»: новое время строки очереди. */
export const rescheduleQueueItem = (id: string, at: string) =>
  request<LinkedinQueueItem>(`${BASE}/queue/${encodeURIComponent(id)}`, {
    ...post({ at }),
    method: 'PATCH',
  });

/** a05b «Снять с очереди». */
export const removeQueueItem = (id: string) =>
  request<LinkedinQueueItem>(`${BASE}/queue/${encodeURIComponent(id)}`, { method: 'DELETE' });
