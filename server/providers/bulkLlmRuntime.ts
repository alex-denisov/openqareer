import { SqliteBulkLlmLedger } from '../data/sqliteBulkLlmLedger';
import { BulkLlmClient, type BulkLlmChannelEvent } from './bulkLlmClient';
import { readBulkLlmConfig } from './bulkLlmConfig';

const OWNER_ALERTS = {
  balance_exhausted:
    'openqareer: на OpenRouter кончился баланс (402). Фоновые задачи ждут в очереди; пополните баланс.',
  channel_down:
    'openqareer: фоновые модели недоступны больше 30 минут. Задачи ждут в очереди и досчитаются сами после восстановления.',
} as const;

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

/**
 * Journal lines for a channel switch and a Telegram message to the owner when the channel cannot
 * work (27.10: 9 hours of 402 went unnoticed). `firstToday` keeps each to one message a UTC day
 * across the three processes and their restarts.
 */
export function channelEventReporter(
  env: NodeJS.ProcessEnv,
  transport: typeof fetch = fetch,
  firstToday: (kind: string) => boolean = () => true,
): (event: BulkLlmChannelEvent) => void {
  return (event) => {
    if (event.kind === 'fallback') {
      console.warn(`bulk-llm stage-cooled reason=${event.reason}`);
      return;
    }
    console.error(`bulk-llm ${event.kind} reason=${event.reason}`);
    if (!firstToday(`owner_alert_${event.kind}`)) return;
    sendOwnerTelegram(env, transport, OWNER_ALERTS[event.kind]);
  };
}

export function createBulkLlmRuntime(options: {
  databasePath: string;
  env?: NodeJS.ProcessEnv;
  transport?: typeof fetch;
  delay?: (ms: number) => Promise<void>;
  now?: () => number;
  random?: () => number;
  onEvent?: (event: BulkLlmChannelEvent) => void;
}) {
  const env = options.env ?? process.env;
  const config = readBulkLlmConfig(env);
  const ledger = new SqliteBulkLlmLedger(options.databasePath);
  return {
    client: config
      ? new BulkLlmClient(config, ledger, options.transport, options.delay, {
          now: options.now,
          random: options.random,
          onEvent:
            options.onEvent ?? channelEventReporter(env, fetch, (kind) => ledger.firstToday(kind)),
        })
      : null,
    ledger,
    status: () => ledger.status(config),
    close: () => ledger.close(),
  };
}
export type BulkLlmRuntime = ReturnType<typeof createBulkLlmRuntime>;
