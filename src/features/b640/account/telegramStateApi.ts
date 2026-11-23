import { apiFetch, readData } from '../../coach/apiClient';
import { prefetch } from './prefetch';

/** B690: состояние привязки Telegram с сервера; имя — только у подключённого. */
export interface TelegramServerState {
  readonly state: 'none' | 'waiting' | 'expired' | 'connected';
  readonly expiresAt: string | null;
  readonly username: string | null;
}

async function fetchTelegramLinkState(): Promise<TelegramServerState> {
  return readData<TelegramServerState>(await apiFetch('/api/v1/candidate/notifications/telegram/state'));
}

/** n02 начинает это чтение вместе со своим; привязка Telegram берёт его готовым. */
export const telegramStateRead = prefetch(fetchTelegramLinkState);

export function getTelegramLinkState(): Promise<TelegramServerState> {
  return telegramStateRead.read();
}
