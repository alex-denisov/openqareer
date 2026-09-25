/**
 * B266: tells the owner about events that need a person (a paid-plan request).
 * Best effort: without a token and chat id it does nothing, a Telegram outage
 * never fails the candidate's request, and the token never reaches a log.
 */
export interface OwnerTelegramConfig {
  readonly telegramBotToken?: string;
  readonly telegramOwnerChatId?: string;
}

const SEND_TIMEOUT_MS = 5_000;

export async function notifyOwner(
  config: OwnerTelegramConfig,
  text: string,
  fetchImpl: typeof fetch = fetch,
): Promise<'sent' | 'disabled' | 'failed'> {
  const { telegramBotToken: token, telegramOwnerChatId: chatId } = config;
  if (!token || !chatId) return 'disabled';
  try {
    const response = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 3_500), disable_web_page_preview: true }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    return response.ok ? 'sent' : 'failed';
  } catch {
    return 'failed';
  }
}
