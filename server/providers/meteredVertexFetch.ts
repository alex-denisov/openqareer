import { SqliteBulkLlmLedger } from '../data/sqliteBulkLlmLedger';
import { maskFailureText, providerFailureText } from './failureReason';
import { createVertexGate, readVertexCreditConfig, type VertexGate } from './vertexCredit';
import { vertexCallCostUsd, vertexOutputTokens, type VertexUsageMetadata } from './vertexPricing';

/**
 * Metering of every Vertex call (owner 04.11): the gate (`vertexCredit.ts`) decides whether Vertex may
 * be asked, this wrapper books the call. A refusal is a `rejected` row at cost 0 with the masked reason,
 * an answer is a `settled` row at the catalog price with the thinking tokens. A failed bookkeeping write
 * never costs the candidate their answer.
 */
const GENERATE_CONTENT = ':generateContent';
const DEFAULT_MODEL_LABEL = 'gemini';
/** A candidate waits for the chain: Vertex, the head of it, gets this long before the cheap stages (04.11). */
export const CANDIDATE_VERTEX_TIMEOUT_MS = 18_000;
const NO_USAGE = { cost: 0, promptTokens: 0, cachedTokens: 0, completionTokens: 0 };

const bookings = new WeakMap<Response, string>();

/** Id of the `bulk_llm_spend` row an answer was booked to (the caller may mark it unusable). */
export function vertexBookingId(response: Response): string | undefined {
  return bookings.get(response);
}

function modelOf(url: string): string {
  const match = /\/models\/([^/:]+):generateContent/u.exec(url);
  return match?.[1] ?? DEFAULT_MODEL_LABEL;
}

function urlOf(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
}

function withTimeout(
  init: RequestInit | undefined,
  timeoutMs: number | undefined,
): RequestInit | undefined {
  if (!timeoutMs) return init;
  const limit = AbortSignal.timeout(timeoutMs);
  const signal = init?.signal ? AbortSignal.any([init.signal, limit]) : limit;
  return { ...init, signal };
}

export interface MeteredFetchOptions {
  gate: VertexGate;
  task: string;
  /** Ceiling of one `generateContent` call; unset keeps the caller's own signal. */
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  /** The caller has passed the gate for this call already (it fetched a token first). */
  preAdmitted?: boolean;
}

/**
 * `fetch` for one mechanic's Vertex calls. A closed gate throws `VertexSkippedError` before any network
 * call, the token request included.
 */
export function createMeteredVertexFetch(options: MeteredFetchOptions): typeof fetch {
  const inner = options.fetchImpl ?? fetch;
  const { gate, task } = options;
  return async (input, init) => {
    const url = urlOf(input);
    if (!options.preAdmitted) gate.admit(task);
    if (!url.includes(GENERATE_CONTENT)) return inner(input, init);
    const model = modelOf(url);
    let response: Response;
    try {
      response = await inner(input, withTimeout(init, options.timeoutMs));
    } catch (error) {
      const text = maskFailureText(
        `${error instanceof Error ? error.name : 'Error'}: ${error instanceof Error ? error.message : 'unknown'}`,
      );
      record(gate, { task, model, failure: text, rejected: true }, NO_USAGE);
      gate.failed({ text });
      throw error;
    }
    if (!response.ok) {
      const text = await providerFailureText(response.clone());
      record(gate, { task, model, failure: text, rejected: true }, NO_USAGE);
      gate.failed({ status: response.status, text });
      return response;
    }
    gate.succeeded();
    await book(gate, task, model, response);
    return response;
  };
}

function record(
  gate: VertexGate,
  input: { task: string; model: string; failure?: string; rejected?: boolean },
  usage: typeof NO_USAGE,
): string | undefined {
  try {
    return gate.ledger.recordGeminiCall?.(input, usage);
  } catch (error) {
    console.error(
      `bulk-llm gemini-book-failed task=${input.task} ${error instanceof Error ? error.name : 'unknown'}`,
    );
    return undefined;
  }
}

async function book(
  gate: VertexGate,
  task: string,
  model: string,
  response: Response,
): Promise<void> {
  let usage: VertexUsageMetadata | undefined;
  let booked = model;
  try {
    const body = (await response.clone().json()) as {
      usageMetadata?: VertexUsageMetadata;
      modelVersion?: unknown;
    };
    usage = body.usageMetadata;
    // The journal names the model that really answered (a dated revision of the pinned one).
    if (typeof body.modelVersion === 'string' && body.modelVersion)
      booked = body.modelVersion.slice(0, 100);
  } catch {
    // The body is the caller's to judge; an unreadable one is booked at zero tokens.
  }
  const id = record(
    gate,
    { task, model: booked },
    {
      cost: vertexCallCostUsd(usage),
      promptTokens: usage?.promptTokenCount ?? 0,
      cachedTokens: usage?.cachedContentTokenCount ?? 0,
      completionTokens: vertexOutputTokens(usage),
    },
  );
  if (id) bookings.set(response, id);
}

const gates = new Map<string, { gate: VertexGate; ledger: SqliteBulkLlmLedger }>();

/**
 * Metered Vertex `fetch` of one mechanic for the process; undefined without a Vertex account.
 * One gate and one ledger connection per database path serve all mechanics of the process, so the
 * cooling after a refusal is shared by them. Mechanics where a candidate waits get a short ceiling.
 */
export function meteredVertexFetchFor(
  vertex: unknown,
  databasePath: string,
  task: string,
  timeoutMs: number | undefined = CANDIDATE_VERTEX_TIMEOUT_MS,
): typeof fetch | undefined {
  if (!vertex) return undefined;
  let entry = gates.get(databasePath);
  if (!entry) {
    const ledger = new SqliteBulkLlmLedger(databasePath);
    entry = {
      ledger,
      gate: createVertexGate({ ledger, config: readVertexCreditConfig(process.env) }),
    };
    gates.set(databasePath, entry);
  }
  return createMeteredVertexFetch({ gate: entry.gate, task, ...(timeoutMs ? { timeoutMs } : {}) });
}
