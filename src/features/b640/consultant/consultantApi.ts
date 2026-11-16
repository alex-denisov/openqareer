import type {
  ConsultantConversationDetail,
  ConsultantConversationSummary,
} from '../../../../server/data/candidateStore';
import { apiFetch, malformedResponseError, readDataObject, throwApiError } from '../../coach/apiClient';

export type { ConsultantConversationDetail, ConsultantConversationSummary };

export interface ConversationPage {
  readonly items: readonly ConsultantConversationSummary[];
  /** Есть — у списка есть продолжение. */
  readonly nextCursor: string | null;
}

const HISTORY_URL = '/api/v1/candidate/consultant-history';

/** Порция прошлых разговоров (сервер отдаёт по 20, последние сверху). */
export async function fetchConversationPage(cursor?: string): Promise<ConversationPage> {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
  const response = await apiFetch(`${HISTORY_URL}${query}`);
  if (!response.ok) await throwApiError(response);
  const body = (await response.json().catch(() => null)) as {
    data?: unknown;
    meta?: { nextCursor?: unknown };
  } | null;
  if (!body || !Array.isArray(body.data)) throw malformedResponseError();
  const nextCursor = body.meta?.nextCursor;
  return {
    items: body.data as ConsultantConversationSummary[],
    nextCursor: typeof nextCursor === 'string' && nextCursor ? nextCursor : null,
  };
}

export async function fetchConversation(id: string): Promise<ConsultantConversationDetail> {
  const response = await apiFetch(`${HISTORY_URL}/${encodeURIComponent(id)}`);
  const detail = await readDataObject<ConsultantConversationDetail>(response);
  if (!Array.isArray(detail.messages)) throw malformedResponseError();
  return detail;
}
