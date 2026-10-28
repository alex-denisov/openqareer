import { SqliteBulkLlmLedger } from '../data/sqliteBulkLlmLedger';
import { BulkLlmClient, type BulkLlmChannelEvent } from './bulkLlmClient';
import { readBulkLlmConfig } from './bulkLlmConfig';
import { VertexBulkFallback, type BulkFallback } from './bulkGeminiFallback';
import { readVertexConfig } from './vertexAi';

/** The Vertex stage of the chain: Gemini on Vertex when the service account is configured. */
function vertexFromEnv(env: NodeJS.ProcessEnv): BulkFallback | undefined {
  const vertex = readVertexConfig(env);
  return vertex ? new VertexBulkFallback(vertex) : undefined;
}

/**
 * Journal lines for a channel switch, and one Telegram message to the owner per process when
 * OpenRouter has no balance left (27.10: 9 hours of 402 went unnoticed).
 */
export function channelEventReporter(
  env: NodeJS.ProcessEnv,
  transport: typeof fetch = fetch,
): (event: BulkLlmChannelEvent) => void {
  let ownerAlerted = false;
  return (event) => {
    if (event.kind === 'fallback') {
      console.warn(`bulk-llm stage-cooled reason=${event.reason}`);
      return;
    }
    console.error('bulk-llm: у провайдера кончился баланс (OpenRouter 402), канал идёт по другим ступеням');
    const token = env.OPENQAREER_TELEGRAM_BOT_TOKEN?.trim();
    const chatId = env.OPENQAREER_TELEGRAM_OWNER_CHAT_ID?.trim();
    if (ownerAlerted || !token || !chatId) return;
    ownerAlerted = true;
    transport(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: 'openqareer: на OpenRouter кончился баланс (402). Массовый канал идёт только через Vertex; пополните баланс.',
      }),
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
  };
}

export function createBulkLlmRuntime(options: {
  databasePath: string;
  env?: NodeJS.ProcessEnv;
  transport?: typeof fetch;
  delay?: (ms: number) => Promise<void>;
  /** The Vertex stage; `null` leaves it out, `undefined` reads it from the env. */
  vertex?: BulkFallback | null;
  now?: () => number;
  onEvent?: (event: BulkLlmChannelEvent) => void;
}) {
  const env = options.env ?? process.env;
  const config = readBulkLlmConfig(env);
  const ledger = new SqliteBulkLlmLedger(options.databasePath);
  const vertex = options.vertex === undefined ? vertexFromEnv(env) : (options.vertex ?? undefined);
  return {
    client: config
      ? new BulkLlmClient(config, ledger, options.transport, options.delay, {
          vertex,
          now: options.now,
          onEvent: options.onEvent ?? channelEventReporter(env),
        })
      : null,
    ledger,
    status: () => ledger.status(config),
    close: () => ledger.close(),
  };
}
export type BulkLlmRuntime = ReturnType<typeof createBulkLlmRuntime>;
