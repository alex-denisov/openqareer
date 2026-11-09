/**
 * B627: maintenance step — ten new directory companies per tick through
 * Vertex Gemini (model knowledge, no search grounding), then HTTP checks.
 * Rollback: OPENQAREER_SITE_DISCOVERY_OFF=1. Needs the Vertex service account.
 */
import type { DatabaseSync } from 'node:sqlite';
import { readVertexConfig, vertexPublisherBaseUrl, VertexTokenProvider } from '../../providers/vertexAi';
import {
  discoveryPrompt,
  parseModelAnswer,
  readPendingCompanies,
  verifyCompany,
  writeDiscovery,
  type PendingCompany,
} from './siteDiscovery';

interface Log {
  info(details: Record<string, unknown>, message: string): void;
  error(details: Record<string, unknown>, message: string): void;
}

const BATCH = 10;
const FIRST_RUN_MS = 7 * 60_000;
const BETWEEN_MS = 2 * 60_000;
const IDLE_MS = 60 * 60_000;

export type AskModel = (prompt: string) => Promise<string>;

export function vertexAsk(environment: Record<string, string | undefined>, fetchImpl: typeof fetch = fetch): AskModel | undefined {
  const config = readVertexConfig(environment);
  if (!config) return undefined;
  const tokens = new VertexTokenProvider(config, fetchImpl);
  const url = `${vertexPublisherBaseUrl(config)}/models/${config.model}:generateContent`;
  return async (prompt) => {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${await tokens.token()}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0, maxOutputTokens: 8192 },
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok) throw new Error(`vertex status ${response.status}`);
    const body = (await response.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    return (body.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('');
  };
}

/** One tick: returns how many companies were checked (0 = nothing pending). */
export async function runSiteDiscoveryTick(
  database: DatabaseSync,
  ask: AskModel,
  fetchImpl: typeof fetch,
  now: Date = new Date(),
): Promise<{ checked: number; boards: number }> {
  const companies: readonly PendingCompany[] = readPendingCompanies(database, BATCH);
  if (companies.length === 0) return { checked: 0, boards: 0 };
  const answers = parseModelAnswer(await ask(discoveryPrompt(companies)));
  const day = now.toISOString().slice(0, 10);
  let boards = 0;
  for (const company of companies) {
    const found = await verifyCompany(company, answers.find((a) => a.key === company.companyKey), fetchImpl, day);
    if (found.board) boards += 1;
    writeDiscovery(database, found, now.toISOString());
  }
  return { checked: companies.length, boards };
}

export function scheduleSiteDiscovery(database: DatabaseSync, log: Log, ask: AskModel | undefined): () => void {
  if (!ask) return () => {};
  let timer: NodeJS.Timeout | undefined;
  let stopped = false;
  const next = (delay: number) => {
    if (stopped) return;
    timer = setTimeout(() => void run(), delay);
    timer.unref();
  };
  const run = async () => {
    try {
      const result = await runSiteDiscoveryTick(database, ask, fetch);
      if (result.checked > 0) log.info(result, 'site-discovery-tick');
      next(result.checked === 0 ? IDLE_MS : BETWEEN_MS);
    } catch (error: unknown) {
      log.error({ errorName: error instanceof Error ? error.name : 'UnknownError' }, 'site-discovery-failed');
      next(IDLE_MS);
    }
  };
  next(FIRST_RUN_MS);
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}
