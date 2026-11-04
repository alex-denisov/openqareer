import { SqliteBulkLlmLedger } from '../data/sqliteBulkLlmLedger';
import { BulkLlmClient, type BulkLlmChannelEvent } from './bulkLlmClient';
import { readBulkLlmConfig } from './bulkLlmConfig';
import { BulkVertexStage } from './bulkVertexStage';
import { readVertexConfig, VertexTokenProvider, type VertexConfig } from './vertexAi';
import { createVertexGate, readVertexCreditConfig } from './vertexCredit';
import { sendOwnerTelegram } from './ownerTelegram';

export { sendOwnerTelegram };

const OWNER_ALERTS = {
  balance_exhausted:
    'openqareer: на OpenRouter кончился баланс (402). Фоновые задачи ждут в очереди; пополните баланс.',
  channel_down:
    'openqareer: фоновые модели недоступны больше 30 минут. Задачи ждут в очереди и досчитаются сами после восстановления.',
} as const;

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

/** Vertex first stage of the channel (04.11); no service account, no stage, and no network for it. */
function buildVertexStage(
  options: Parameters<typeof createBulkLlmRuntime>[0],
  env: NodeJS.ProcessEnv,
  ledger: SqliteBulkLlmLedger,
): BulkVertexStage | undefined {
  let vertex: VertexConfig | null | undefined = options.vertex;
  if (vertex === undefined) {
    try {
      vertex = readVertexConfig(env) ?? null;
    } catch (error) {
      console.error(`bulk-llm vertex-config-invalid ${error instanceof Error ? error.name : 'unknown'}`);
      vertex = null;
    }
  }
  if (!vertex) return undefined;
  const transport = options.transport ?? fetch;
  const tokens = new VertexTokenProvider(vertex, transport);
  return new BulkVertexStage({
    config: vertex,
    gate: createVertexGate({
      ledger,
      config: readVertexCreditConfig(env),
      env,
      transport,
      ...(options.now ? { now: options.now } : {}),
    }),
    ledger,
    token: options.vertexToken ?? (() => tokens.token()),
    transport,
  });
}

export function createBulkLlmRuntime(options: {
  databasePath: string;
  env?: NodeJS.ProcessEnv;
  transport?: typeof fetch;
  delay?: (ms: number) => Promise<void>;
  now?: () => number;
  random?: () => number;
  onEvent?: (event: BulkLlmChannelEvent) => void;
  /** Service account of Vertex; undefined reads it from the env, null means no Vertex stage. */
  vertex?: VertexConfig | null;
  /** Access token of Vertex; tests fix it, the default signs one with the service account. */
  vertexToken?: () => Promise<string>;
}) {
  const env = options.env ?? process.env;
  const config = readBulkLlmConfig(env);
  const ledger = new SqliteBulkLlmLedger(options.databasePath);
  const vertexStage = buildVertexStage(options, env, ledger);
  return {
    client: config
      ? new BulkLlmClient(config, ledger, options.transport, options.delay, {
          now: options.now,
          random: options.random,
          ...(vertexStage ? { vertex: vertexStage } : {}),
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
