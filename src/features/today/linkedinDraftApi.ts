import { apiFetch, readData } from '../coach/apiClient';
export interface LinkedinDraft {
  readonly id: string;
  readonly kind: 'post' | 'comment';
  readonly topic: string;
  readonly text: string;
  readonly status: 'draft' | 'copied' | 'rejected';
}
export class DraftApiError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(url, init);
  if (!response.ok) {
    try { return await readData<T>(response); }
    catch (error) { throw new DraftApiError(response.status, error instanceof Error ? error.message : 'Не удалось завершить действие'); }
  }
  return readData<T>(response);
}
export const listDrafts = () => request<LinkedinDraft[]>('/api/v1/candidate/drafts?limit=3');
export const createDraft = (input: { kind: LinkedinDraft['kind']; topic: string; sourceText?: string }) =>
  request<LinkedinDraft>('/api/v1/candidate/drafts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
export const updateDraft = (id: string, status: 'copied' | 'rejected') =>
  request<LinkedinDraft>(`/api/v1/candidate/drafts/${encodeURIComponent(id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) });
