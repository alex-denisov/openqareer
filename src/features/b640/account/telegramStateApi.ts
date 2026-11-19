import { apiFetch, readData } from '../../coach/apiClient';

/** B690: состояние привязки Telegram с сервера; имя — только у подключённого. */
export interface TelegramServerState {
  readonly state: 'none' | 'waiting' | 'expired' | 'connected';
  readonly expiresAt: string | null;
  readonly username: string | null;
}

export async function getTelegramLinkState(): Promise<TelegramServerState> {
  return readData<TelegramServerState>(await apiFetch('/api/v1/candidate/notifications/telegram/state'));
}
