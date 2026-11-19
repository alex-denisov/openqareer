import type {
  B640ContactMessage,
  B640ContactMessageApproval,
  B640ContactMessageKind,
  B640ContactMessageSent,
} from '../../../../../shared/b640ContactMessage';
import { apiFetch, readData } from '../../../coach/apiClient';

const BASE = '/api/v1/candidate/b640/contact-messages';
const JSON_HEADERS = { 'Content-Type': 'application/json' };
const messageUrl = (id: string, tail = '') => `${BASE}/${encodeURIComponent(id)}${tail}`;

export type {
  B640ContactMessage,
  B640ContactMessageApproval,
  B640ContactMessageKind,
  B640ContactMessageSent,
};

/** Черновик сообщения контакту; платформа ничего не отправляет. */
export async function createB640ContactMessage(
  contactId: string,
  kind: B640ContactMessageKind,
): Promise<B640ContactMessage> {
  const response = await apiFetch(BASE, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ contactId, kind }),
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
