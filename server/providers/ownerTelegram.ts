/** One Telegram message to the owner; no token or chat id means silence. Failures reach the journal only. */
export function sendOwnerTelegram(
  env: NodeJS.ProcessEnv,
  transport: typeof fetch,
  text: string,
): void {
  const token = env.OPENQAREER_TELEGRAM_BOT_TOKEN?.trim();
  const chatId = env.OPENQAREER_TELEGRAM_OWNER_CHAT_ID?.trim();
  if (!token || !chatId) return;
  transport(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
    signal: AbortSignal.timeout(10_000),
  })
    .then((response) => {
      if (!response.ok) console.error(`bulk-llm owner alert status ${response.status}`);
    })
    .catch((error: unknown) => {
      console.error(
        `bulk-llm owner alert failed: ${error instanceof Error ? error.name : 'unknown'}`,
      );
    });
}
