import type {
  B640ContactMessage,
  B640ContactMessageApproval,
  B640ContactMessageKind,
  B640ContactMessageSent,
  B640SentContactMessage,
} from '../../../../shared/b640ContactMessage';
import { apiFetch, readData } from '../../coach/apiClient';

const BASE = '/api/v1/candidate/b640/contact-messages';
const JSON_HEADERS = { 'Content-Type': 'application/json' };
const messageUrl = (id: string, tail = '') => `${BASE}/${encodeURIComponent(id)}${tail}`;

export type {
  B640ContactMessage,
  B640ContactMessageApproval,
  B640ContactMessageKind,
  B640ContactMessageSent,
  B640SentContactMessage,
};

/** Кому пишем: знакомый из сети или рекрутёр вакансии (нужны оба поля). */
export type B640MessageTarget =
  { readonly contactId: string } | { readonly recruiterId: string; readonly vacancyId: string };

/** Черновик сообщения; платформа ничего не отправляет. Каждый вызов — новый вариант текста. */
export async function createB640ContactMessage(
  target: B640MessageTarget,
  kind: B640ContactMessageKind,
): Promise<B640ContactMessage> {
  const response = await apiFetch(BASE, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ ...target, kind }),
  });
  return readData<B640ContactMessage>(response);
}

export async function editB640ContactMessage(
  id: string,
  text: string,
): Promise<B640ContactMessage> {
  const response = await apiFetch(messageUrl(id), {
    method: 'PUT',
    headers: JSON_HEADERS,
    body: JSON.stringify({ text }),
  });
  return readData<B640ContactMessage>(response);
}

/** Одобрение: в ответе `openUrl` — профиль получателя, только https linkedin.com, иначе null. */
export async function approveB640ContactMessage(id: string): Promise<B640ContactMessageApproval> {
  const response = await apiFetch(messageUrl(id, '/approve'), { method: 'POST' });
  return readData<B640ContactMessageApproval>(response);
}

/** «Отправил»: сервер ставит контакту статус «писали». */
export async function markB640ContactMessageSent(id: string): Promise<B640ContactMessageSent> {
  const response = await apiFetch(messageUrl(id, '/sent'), { method: 'POST' });
  return readData<B640ContactMessageSent>(response);
}

/** Отправленные по вакансии (без текста) — для «Что было» в отклике. */
export async function listB640SentMessages(
  vacancyId: string,
  signal?: AbortSignal,
): Promise<readonly B640SentContactMessage[]> {
  const response = await apiFetch(`${BASE}/sent?vacancyId=${encodeURIComponent(vacancyId)}`, { signal });
  return (await readData<{ readonly items: readonly B640SentContactMessage[] }>(response)).items;
}
