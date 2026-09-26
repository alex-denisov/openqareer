/**
 * B266: tells the owner about events that need a person (a paid-plan request).
 * Best effort: without a token and chat id it does nothing, a Telegram outage
 * never fails the candidate's request, and the token never reaches a log.
 */
export interface OwnerTelegramConfig {
  readonly telegramBotToken?: string;
  readonly telegramOwnerChatId?: string;
}

export type OwnerTelegramOutcome =
  | { readonly status: 'sent'; readonly httpStatus: number; readonly messageId: number }
  | { readonly status: 'disabled' }
  | {
      readonly status: 'failed';
      readonly reason: 'http' | 'invalid_response' | 'network';
      readonly httpStatus?: number;
    };

const SEND_TIMEOUT_MS = 5_000;

export async function notifyOwner(
  config: OwnerTelegramConfig,
  text: string,
  fetchImpl: typeof fetch = fetch,
): Promise<OwnerTelegramOutcome> {
  const { telegramBotToken: token, telegramOwnerChatId: chatId } = config;
  if (!token || !chatId) return { status: 'disabled' };
  try {
    const response = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 3_500), disable_web_page_preview: true }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    if (!response.ok) return { status: 'failed', reason: 'http', httpStatus: response.status };
    const body = (await response.json().catch(() => null)) as
      | { ok?: unknown; result?: { message_id?: unknown } }
      | null;
    const messageId = body?.result?.message_id;
    if (body?.ok !== true || !Number.isSafeInteger(messageId)) {
      return { status: 'failed', reason: 'invalid_response', httpStatus: response.status };
    }
    return { status: 'sent', httpStatus: response.status, messageId: messageId as number };
  } catch {
    return { status: 'failed', reason: 'network' };
  }
}
