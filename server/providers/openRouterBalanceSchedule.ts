/**
 * Hourly low-balance alert for the OpenRouter key, run in the maintenance process.
 * The alert is sent at most once per UTC day; the mark lives in `bulk_llm_events`, so the
 * process restarts (up to 10 a night) do not reset it.
 */
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import {
  notifyOwner,
  type OwnerTelegramConfig,
  type OwnerTelegramOutcome,
} from '../notifications/ownerTelegram';

interface BalanceLog {
  info(details: Record<string, unknown>, message: string): void;
  error(details: Record<string, unknown>, message: string): void;
}

/**
 * $5 by default. Over the last 7 days the key spent ~$1.43 a day on average
 * (`usage_weekly` $10.08); the dearest day in the journal was $13.4. $5 is about 3.5 days
 * of the usual spend and ~9 hours of the worst day: enough time to top up.
 * Override with `OPENQAREER_OPENROUTER_BALANCE_ALERT_USD`.
 */
export const DEFAULT_BALANCE_ALERT_USD = 5;
const CREDITS_URL = 'https://openrouter.ai/api/v1/credits';
const CHECK_MS = 60 * 60_000;
const FIRST_CHECK_MS = 120_000;
const REQUEST_TIMEOUT_MS = 10_000;

const creditsSchema = z.object({
  data: z.object({ total_credits: z.number().finite(), total_usage: z.number().finite() }),
});

export interface BalanceCheckDeps {
  readonly database: DatabaseSync;
  readonly apiKey: string;
  readonly thresholdUsd: number;
  readonly telegram: OwnerTelegramConfig;
  readonly log: BalanceLog;
  readonly fetchImpl?: typeof fetch;
  readonly notify?: (config: OwnerTelegramConfig, text: string) => Promise<OwnerTelegramOutcome>;
  readonly now?: () => Date;
}

export function readBalanceThreshold(env: NodeJS.ProcessEnv): number {
  const parsed = Number(env.OPENQAREER_OPENROUTER_BALANCE_ALERT_USD);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_BALANCE_ALERT_USD;
}

async function readRemainingUsd(apiKey: string, fetchImpl: typeof fetch): Promise<number> {
  const response = await fetchImpl(CREDITS_URL, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`http_${response.status}`);
  const { data } = creditsSchema.parse(await response.json());
  return data.total_credits - data.total_usage;
}

function money(value: number): string {
  return `$${value.toFixed(2)}`;
}

function failureReason(error: unknown): string {
  if (error instanceof z.ZodError) return 'invalid_response';
  return error instanceof Error ? error.message : 'unknown';
}

/** One check. Never throws: a failed request is logged and nothing is sent. */
export async function checkOpenRouterBalance(deps: BalanceCheckDeps): Promise<void> {
  const { database, thresholdUsd, log } = deps;
  let remainingUsd: number;
  try {
    remainingUsd = await readRemainingUsd(deps.apiKey, deps.fetchImpl ?? fetch);
  } catch (error: unknown) {
    log.error({ reason: failureReason(error) }, 'openrouter-balance-failed');
    return;
  }
  log.info({ remainingUsd, thresholdUsd }, 'openrouter-balance');
  if (remainingUsd >= thresholdUsd) return;
  try {
    const now = (deps.now ?? (() => new Date()))();
    const id = `openrouter_low_balance:${now.toISOString().slice(0, 10)}`;
    database.exec(
      'CREATE TABLE IF NOT EXISTS bulk_llm_events(id TEXT PRIMARY KEY,kind TEXT NOT NULL,created_at TEXT NOT NULL)',
    );
    if (database.prepare('SELECT 1 FROM bulk_llm_events WHERE id = ?').get(id)) return;
    const text =
      `На балансе OpenRouter осталось ${money(remainingUsd)}, это меньше порога ${money(thresholdUsd)}. ` +
      'Пополните баланс, иначе подбор и сводки перестанут работать.';
    const outcome = await (deps.notify ?? notifyOwner)(deps.telegram, text);
    if (outcome.status === 'failed') {
      log.error({ reason: outcome.reason }, 'openrouter-balance-notify-failed');
      return;
    }
    database
      .prepare('INSERT OR IGNORE INTO bulk_llm_events(id, kind, created_at) VALUES(?,?,?)')
      .run(id, 'openrouter_low_balance', now.toISOString());
  } catch (error: unknown) {
    log.error({ reason: failureReason(error) }, 'openrouter-balance-failed');
  }
}

export function scheduleOpenRouterBalanceAlert(
  database: DatabaseSync,
  apiKey: string | undefined,
  telegram: OwnerTelegramConfig,
  log: BalanceLog,
  env: NodeJS.ProcessEnv = process.env,
): () => void {
  if (!apiKey) {
    log.info({}, 'openrouter-balance-off');
    return () => undefined;
  }
  const run = () =>
    void checkOpenRouterBalance({
      database,
      apiKey,
      thresholdUsd: readBalanceThreshold(env),
      telegram,
      log,
    });
  const first = setTimeout(run, FIRST_CHECK_MS);
  const every = setInterval(run, CHECK_MS);
  first.unref();
  every.unref();
  return () => {
    clearTimeout(first);
    clearInterval(every);
  };
}
