import { SqliteBulkLlmLedger } from '../data/sqliteBulkLlmLedger';
import { sendOwnerTelegram } from './bulkLlmRuntime';
import { vertexCallCostUsd, vertexOutputTokens, type VertexUsageMetadata } from './vertexPricing';

/**
 * Metering and the daily money cap of the Vertex stage (owner 04.11). Candidate chains start with a
 * cheap model; Vertex is the dear last stage and may spend at most this much a UTC day. At the cap the
 * stage is refused (the chain keeps what the cheap stages answered, or ends with its usual error);
 * the background channel and its overrun latch are not involved.
 */
export const DEFAULT_GEMINI_DAY_USD = 1;
const GEMINI_DAY_ENV = 'OPENQAREER_BULK_GEMINI_DAY_USD';
const GENERATE_CONTENT = ':generateContent';
const DEFAULT_MODEL_LABEL = 'gemini';

/** The stage is refused: the chain treats it like any failed stage. */
export class GeminiDayCapError extends Error {
  constructor(
    readonly spentUsd: number,
    readonly capUsd: number,
  ) {
    super('gemini day cap reached');
    this.name = 'GeminiDayCapError';
  }
}

/** Read once at start; a missing value is the default quietly, a bad one is the default with a journal line. */
export function readGeminiDayCapUsd(
  env: Record<string, string | undefined>,
  warn: (line: string) => void = console.warn,
): number {
  const raw = env[GEMINI_DAY_ENV]?.trim();
  if (raw === undefined || raw === '') return DEFAULT_GEMINI_DAY_USD;
  const value = Number(raw);
  if (Number.isFinite(value) && value > 0) return value;
  warn(`bulk-llm gemini-day-cap-invalid value ignored, default ${DEFAULT_GEMINI_DAY_USD}`);
  return DEFAULT_GEMINI_DAY_USD;
}

export interface GeminiBooks {
  geminiDaySpentUsd(): number;
  recordGeminiCall: SqliteBulkLlmLedger['recordGeminiCall'];
}

function modelOf(url: string): string {
  const match = /\/models\/([^/:]+):generateContent/u.exec(url);
  return match?.[1] ?? DEFAULT_MODEL_LABEL;
}

function urlOf(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
}

/**
 * `fetch` for one mechanic's Vertex calls. Only `generateContent` is counted; the token request passes
 * through. A failed bookkeeping write never costs the candidate their answer.
 */
export function createMeteredVertexFetch(options: {
  ledger: GeminiBooks;
  dayUsd: number;
  task: string;
  onCap: (spentUsd: number, capUsd: number) => void;
  fetchImpl?: typeof fetch;
}): typeof fetch {
  const inner = options.fetchImpl ?? fetch;
  return async (input, init) => {
    const url = urlOf(input);
    if (!url.includes(GENERATE_CONTENT)) return inner(input, init);
    const spent = options.ledger.geminiDaySpentUsd();
    if (spent >= options.dayUsd) {
      options.onCap(spent, options.dayUsd);
      throw new GeminiDayCapError(spent, options.dayUsd);
    }
    const response = await inner(input, init);
    if (!response.ok) return response;
    await book(options, url, response.clone());
    return response;
  };
}

async function book(
  options: Parameters<typeof createMeteredVertexFetch>[0],
  url: string,
  copy: Response,
): Promise<void> {
  try {
    const body = (await copy.json()) as { usageMetadata?: VertexUsageMetadata };
    const usage = body.usageMetadata;
    options.ledger.recordGeminiCall(
      { task: options.task, model: modelOf(url) },
      {
        cost: vertexCallCostUsd(usage),
        promptTokens: usage?.promptTokenCount ?? 0,
        cachedTokens: usage?.cachedContentTokenCount ?? 0,
        completionTokens: vertexOutputTokens(usage),
      },
    );
  } catch (error) {
    console.error(
      `bulk-llm gemini-book-failed task=${options.task} ${error instanceof Error ? error.name : 'unknown'}`,
    );
  }
}

/** Journal line at every refusal; the owner gets one Telegram message a UTC day. */
export function geminiCapReporter(
  env: NodeJS.ProcessEnv,
  transport: typeof fetch = fetch,
  firstToday: (kind: string) => boolean = () => true,
): (spentUsd: number, capUsd: number) => void {
  return (spentUsd, capUsd) => {
    console.error(`bulk-llm gemini-day-cap spent=${spentUsd.toFixed(4)} cap=${capUsd.toFixed(4)}`);
    if (!firstToday('owner_alert_gemini_day_cap')) return;
    sendOwnerTelegram(
      env,
      transport,
      `openqareer: дорогая модель Gemini израсходовала дневной предел (${spentUsd.toFixed(2)} из ${capUsd.toFixed(2)} долларов). До завтра кандидаты получают ответы дешёвых моделей; если они не справятся, будет обычная ошибка.`,
    );
  };
}

const meters = new Map<string, ReturnType<typeof createVertexMeter>>();

/**
 * Metered Vertex `fetch` of one mechanic for the process; undefined without a Vertex account.
 * One ledger connection per database path is shared by all mechanics.
 */
export function meteredVertexFetchFor(
  vertex: unknown,
  databasePath: string,
  task: string,
): typeof fetch | undefined {
  if (!vertex) return undefined;
  const meter = meters.get(databasePath) ?? createVertexMeter({ databasePath });
  meters.set(databasePath, meter);
  return meter.fetchFor(task);
}

/** Process-level wiring: one book per process, one fetch per mechanic. */
export function createVertexMeter(options: {
  databasePath: string;
  env?: NodeJS.ProcessEnv;
  transport?: typeof fetch;
}): { fetchFor: (task: string) => typeof fetch; close: () => void } {
  const env = options.env ?? process.env;
  const ledger = new SqliteBulkLlmLedger(options.databasePath);
  const dayUsd = readGeminiDayCapUsd(env);
  const onCap = geminiCapReporter(env, options.transport, (kind) => ledger.firstToday(kind));
  return {
    fetchFor: (task) => createMeteredVertexFetch({ ledger, dayUsd, task, onCap }),
    close: () => ledger.close(),
  };
}
