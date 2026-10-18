import { apiFetch, readData } from '../coach/apiClient';

export type LinkedinDraftStatus = 'draft' | 'copied' | 'rejected' | 'approved' | 'published';

export interface LinkedinDraft {
  readonly id: string;
  readonly kind: 'post' | 'comment';
  readonly topic: string;
  readonly text: string;
  readonly status: LinkedinDraftStatus;
  readonly approvedAt?: string;
  readonly publishedAt?: string;
}

export interface LinkedinDraftTopic {
  readonly id: string;
  readonly title: string;
  readonly source: string;
  readonly sourceRef: string;
}

export interface LinkedinDraftCadence {
  readonly timezone: string;
  readonly lastPublishedAt: string | null;
  readonly nextAllowedAt: string | null;
  readonly canPublish: boolean;
}

export interface LinkedinDraftTopicPage {
  readonly items: readonly LinkedinDraftTopic[];
  readonly total: number;
  readonly cadence: LinkedinDraftCadence;
}

export class DraftApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(url, init);
  if (!response.ok) {
    try {
      return await readData<T>(response);
    } catch (error) {
      throw new DraftApiError(
        response.status,
        error instanceof Error ? error.message : 'Не удалось завершить действие',
      );
    }
  }
  return readData<T>(response);
}

export const listDrafts = (limit = 20) =>
  request<LinkedinDraft[]>(`/api/v1/candidate/drafts?limit=${limit}`);

export const listDraftTopics = (limit = 3, offset = 0) =>
  request<LinkedinDraftTopicPage>(
    `/api/v1/candidate/drafts/topics?limit=${limit}&offset=${offset}`,
  );

export const dismissDraftTopic = (id: string) =>
  request<{ id: string; decision: 'dismissed' }>(
    `/api/v1/candidate/drafts/topics/${encodeURIComponent(id)}/dismiss`,
    { method: 'POST' },
  );

export const createDraft = (input: {
  kind: LinkedinDraft['kind'];
  topic: string;
  sourceText?: string;
  topicId?: string;
  inputType?: 'topic' | 'text' | 'sketch';
  tone?: 'business' | 'personal' | 'expert';
  length?: 'short' | 'medium' | 'long';
}) =>
  request<LinkedinDraft>('/api/v1/candidate/drafts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });

export const updateDraft = (
  id: string,
  update: { status: 'copied' | 'rejected' | 'approved' | 'published' } | { text: string },
) =>
  request<LinkedinDraft>(`/api/v1/candidate/drafts/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(update),
  });
