/** Узкий клиент Bot API для SMM-чата владельца. Токен живёт только в адресе запроса и в журнал не попадает. */

const API = 'https://api.telegram.org';
const REQUEST_TIMEOUT_MS = 15_000;
export const POLL_TIMEOUT_S = 50;
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

export interface InlineButton {
  readonly text: string;
  readonly callback_data: string;
}

export interface TelegramMessage {
  readonly message_id: number;
  readonly chat: { readonly id: number };
  readonly text?: string;
  readonly caption?: string;
  readonly photo?: ReadonlyArray<{ readonly file_id: string; readonly file_size?: number }>;
  readonly reply_to_message?: { readonly message_id: number };
}

export interface TelegramUpdate {
  readonly update_id: number;
  readonly message?: TelegramMessage;
  readonly callback_query?: {
    readonly id: string;
    readonly data?: string;
    readonly message?: TelegramMessage;
  };
}

export interface SmmTelegram {
  getUpdates(offset: number): Promise<TelegramUpdate[]>;
  send(chatId: string, text: string, buttons?: readonly InlineButton[]): Promise<number | null>;
  answerCallback(callbackId: string, text: string): Promise<void>;
  clearButtons(chatId: string, messageId: number): Promise<void>;
  downloadPhoto(fileId: string): Promise<Uint8Array | null>;
}

export class TelegramApiError extends Error {
  constructor(
    readonly method: string,
    readonly status: number,
  ) {
    super(`telegram ${method} ${status}`);
    this.name = 'TelegramApiError';
  }
}

export const TELEGRAM_TEXT_MAX = 4_000;

async function telegramCall<T>(
  token: string,
  fetchImpl: typeof fetch,
  method: string,
  body: Record<string, unknown>,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<T> {
  const response = await fetchImpl(`${API}/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const payload = (await response.json().catch(() => null)) as {
    ok?: boolean;
    result?: T;
  } | null;
  if (!response.ok || payload?.ok !== true) throw new TelegramApiError(method, response.status);
  return payload.result as T;
}

export function createSmmTelegram(token: string, fetchImpl: typeof fetch = fetch): SmmTelegram {
  const call = <T>(method: string, body: Record<string, unknown>, timeoutMs?: number) =>
    telegramCall<T>(token, fetchImpl, method, body, timeoutMs);

  return {
    getUpdates: (offset) =>
      call<TelegramUpdate[]>(
        'getUpdates',
        { offset, timeout: POLL_TIMEOUT_S, allowed_updates: ['message', 'callback_query'] },
        (POLL_TIMEOUT_S + 10) * 1_000,
      ),
    async send(chatId, text, buttons) {
      const result = await call<{ message_id: number }>('sendMessage', {
        chat_id: chatId,
        text: text.slice(0, TELEGRAM_TEXT_MAX),
        disable_web_page_preview: true,
        ...(buttons ? { reply_markup: { inline_keyboard: [buttons] } } : {}),
      });
      return result.message_id;
    },
    async answerCallback(callbackId, text) {
      await call('answerCallbackQuery', {
        callback_query_id: callbackId,
        text: text.slice(0, 190),
      });
    },
    async clearButtons(chatId, messageId) {
      await call('editMessageReplyMarkup', {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: { inline_keyboard: [] },
      });
    },
    async downloadPhoto(fileId) {
      const file = await call<{ file_path?: string; file_size?: number }>('getFile', {
        file_id: fileId,
      });
      if (!file.file_path || (file.file_size ?? 0) > MAX_PHOTO_BYTES) return null;
      const response = await fetchImpl(`${API}/file/bot${token}/${file.file_path}`, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) return null;
      const bytes = new Uint8Array(await response.arrayBuffer());
      return bytes.byteLength > MAX_PHOTO_BYTES ? null : bytes;
    },
  };
}
