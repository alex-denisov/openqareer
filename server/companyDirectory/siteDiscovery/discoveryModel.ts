/**
 * B627 (owner 10.11): the model behind site discovery. Vertex Gemini first, booked to
 * `bulk_llm_spend` under its own task with a hard $40 ceiling; past the ceiling (or without a
 * Vertex account) the free OpenRouter pool `openrouter/free`. Availability failures of the free
 * pool (429, 5xx, timeouts, no provider) are retried with exponential backoff and jitter — the
 * company is never dropped for them. The answer stays a candidate; HTTP checks decide.
 */
import type { DatabaseSync } from 'node:sqlite';
import { meteredVertexFetchFor } from '../../providers/meteredVertexFetch';
import { readVertexConfig, vertexPublisherBaseUrl, VertexTokenProvider } from '../../providers/vertexAi';

export const SITE_DISCOVERY_TASK = 'site-discovery';
export const SITE_DISCOVERY_VERTEX_CAP_USD = 40;
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_MODEL = 'openrouter/free';
const MAX_ATTEMPTS = 8;
const BASE_DELAY_MS = 2_000;
const MAX_DELAY_MS = 120_000;

export type ModelRoute = 'vertex' | 'openrouter';
export interface ModelReply {
  readonly text: string;
  readonly route: ModelRoute;
}
export type AskModel = (prompt: string) => Promise<ModelReply>;

export function vertexSpentUsd(database: DatabaseSync): number {
  const row = database
    .prepare(
      `SELECT COALESCE(SUM(cost), 0) AS spent FROM bulk_llm_spend WHERE task = ? AND provider = 'gemini'`,
    )
    .get(SITE_DISCOVERY_TASK) as { spent: number } | undefined;
  return row?.spent ?? 0;
}

function hasSpendTable(database: DatabaseSync): boolean {
  return Boolean(
    database.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'bulk_llm_spend'`).get(),
  );
}

/** A retryable availability failure of the free pool (not a malformed request). */
export function isAvailabilityFailure(status: number): boolean {
  return status === 408 || status === 429 || status >= 500 || status === 404;
}

export function backoffMs(attempt: number, random: () => number = Math.random): number {
  const ceiling = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** attempt);
  return Math.round(ceiling / 2 + random() * (ceiling / 2));
}

interface Deps {
  readonly fetchImpl?: typeof fetch;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly vertexFetch?: typeof fetch;
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function openRouterAsk(apiKey: string, deps: Deps = {}): (prompt: string) => Promise<string> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const sleep = deps.sleep ?? wait;
  return async (prompt) => {
    let lastFailure = 'no attempt';
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      if (attempt > 0) await sleep(backoffMs(attempt));
      try {
        const response = await fetchImpl(OPENROUTER_URL, {
          method: 'POST',
          headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
          body: JSON.stringify({ model: OPENROUTER_MODEL, temperature: 0, messages: [{ role: 'user', content: prompt }] }),
          signal: AbortSignal.timeout(120_000),
        });
        if (!response.ok) {
          lastFailure = `status ${response.status}`;
          if (isAvailabilityFailure(response.status)) continue;
          throw new Error(`openrouter ${lastFailure}`);
        }
        const body = (await response.json()) as { choices?: { message?: { content?: string } }[] };
        const text = body.choices?.[0]?.message?.content ?? '';
        if (text) return text;
        lastFailure = 'empty answer';
      } catch (error: unknown) {
        if (error instanceof Error && error.message.startsWith('openrouter status')) throw error;
        lastFailure = error instanceof Error ? error.name : 'UnknownError';
      }
    }
    throw new Error(`openrouter unavailable after ${MAX_ATTEMPTS} attempts: ${lastFailure}`);
  };
}

function vertexOnce(environment: Record<string, string | undefined>, metered: typeof fetch) {
  const config = readVertexConfig(environment);
  if (!config) return undefined;
  const tokens = new VertexTokenProvider(config, metered);
  const url = `${vertexPublisherBaseUrl(config)}/models/${config.model}:generateContent`;
  return async (prompt: string): Promise<string> => {
    const response = await metered(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${await tokens.token()}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0, maxOutputTokens: 8192 },
      }),
    });
    if (!response.ok) throw new Error(`vertex status ${response.status}`);
    const body = (await response.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    return (body.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('');
  };
}

/** Vertex under the cap, then the free pool; undefined when neither is configured. */
export function discoveryModel(
  database: DatabaseSync,
  databasePath: string,
  environment: Record<string, string | undefined>,
  deps: Deps = {},
): AskModel | undefined {
  const metered =
    deps.vertexFetch ?? meteredVertexFetchFor(readVertexConfig(environment), databasePath, SITE_DISCOVERY_TASK, 120_000);
  const vertex = metered ? vertexOnce(environment, metered) : undefined;
  const key = environment.OPENQAREER_OPENROUTER_API_KEY;
  const free = key ? openRouterAsk(key, deps) : undefined;
  if (!vertex && !free) return undefined;
  return async (prompt) => {
    const underCap = hasSpendTable(database) && vertexSpentUsd(database) < SITE_DISCOVERY_VERTEX_CAP_USD;
    if (vertex && underCap) {
      try {
        return { text: await vertex(prompt), route: 'vertex' };
      } catch (error: unknown) {
        if (!free) throw error;
      }
    }
    if (!free) throw new Error('site discovery: Vertex cap reached and no OpenRouter key');
    return { text: await free(prompt), route: 'openrouter' };
  };
}
