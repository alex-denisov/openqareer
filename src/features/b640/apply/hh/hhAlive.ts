import { apiFetch } from '../../../coach/apiClient';

/**
 * B704: страница hh.ru в окне кандидата показала вошедшего — сервер снимает «вход истёк» на всех
 * экранах. Сбой записи чтение не срывает: о живом входе сообщит следующее чтение.
 */
export async function reportHhAlive(): Promise<void> {
  await apiFetch('/api/v1/candidate/b640/hh/session/alive', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  }).catch(() => undefined);
}
