import type {
  ConsultantConversationDetail,
  ConsultantConversationSummary,
} from '../../../../server/data/candidateStore';
import type { CoachTurnStage } from '../../coach/coachApi';
import {
  apiFetch,
  malformedResponseError,
  readData,
  readDataObject,
  throwApiError,
} from '../../coach/apiClient';
import { readReplies, type ConsultantReplyExtras } from './replyModel';

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
  return checkedDetail(await readDataObject<ConsultantConversationDetail>(response));
}

const CONSULTANT_URL = '/api/v1/candidate/consultant';

function checkedDetail(detail: ConsultantConversationDetail): ConsultantConversationDetail {
  if (!Array.isArray(detail.messages)) throw malformedResponseError();
  return detail;
}

/** Открытый разговор и действия со ссылками под его ответами. */
export interface CurrentConversation extends ConsultantConversationDetail {
  readonly replies: readonly ConsultantReplyExtras[];
  /** Фоновый разбор ответа ещё идёт: действия под ним придут позже. */
  readonly analysisPending: boolean;
}

/** Открытый разговор раздела (B688); `null` — разговор ещё не начат. */
export async function fetchCurrentConversation(
  stage: CoachTurnStage,
): Promise<CurrentConversation | null> {
  const response = await apiFetch(`${CONSULTANT_URL}/current?stage=${encodeURIComponent(stage)}`);
  const detail = await readData<
    (ConsultantConversationDetail & { replies?: unknown; analysisPending?: unknown }) | null
  >(
    response,
  );
  return detail === null
    ? null
    : {
        ...checkedDetail(detail),
        replies: readReplies(detail.replies),
        analysisPending: detail.analysisPending === true,
      };
}

/** «Новый разговор»: открытый разговор уходит в «Все разговоры». */
export async function closeCurrentConversation(): Promise<void> {
  const response = await apiFetch(`${CONSULTANT_URL}/current/close`, { method: 'POST' });
  if (!response.ok) await throwApiError(response);
}

/** Продолжить закрытый разговор: он снова открыт, текущий закрыт. */
export async function resumeConversation(id: string): Promise<ConsultantConversationDetail> {
  const response = await apiFetch(
    `${CONSULTANT_URL}/conversations/${encodeURIComponent(id)}/resume`,
    { method: 'POST' },
  );
  return checkedDetail(await readDataObject<ConsultantConversationDetail>(response));
}

/** «Верно»: запись подтверждена и стоит в истории профиля, где её можно вернуть. */
export async function confirmFact(memoryId: string): Promise<void> {
  const response = await apiFetch(
    `${CONSULTANT_URL}/facts/${encodeURIComponent(memoryId)}/confirm`,
    { method: 'POST' },
  );
  if (!response.ok) await throwApiError(response);
}
