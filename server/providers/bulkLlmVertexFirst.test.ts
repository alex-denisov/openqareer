import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BulkChannelUnavailable, type BulkLlmChannelEvent } from './bulkLlmClient';
import { createBulkLlmRuntime } from './bulkLlmRuntime';
import type { VertexConfig } from './vertexAi';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

const VERTEX: VertexConfig = {
  projectId: 'p',
  clientEmail: 'e@x',
  privateKey: 'k',
  model: 'gemini-3.8-flash',
  location: 'global',
};
const baseEnv = {
  OPENQAREER_OPENROUTER_API_KEY: 'secret',
  OPENQAREER_BULK_LLM_ENABLED: 'true',
  OPENQAREER_BULK_LLM_RUN_USD: '0.1',
  OPENQAREER_BULK_LLM_DAY_USD: '0.1',
  OPENQAREER_BULK_LLM_TOTAL_USD: '0.1',
  OPENQAREER_BULK_LLM_REQUEST_USD: '0.06',
  OPENQAREER_VERTEX_CREDIT_UNTIL: '2099-01-01',
};
const req = {
  runId: 'run',
  task: 'requirements',
  dataClass: 'public' as const,
  prefix: 'stable',
  input: 'vacancy',
};

const vertexAnswer = (text = '{"ok":true}') =>
  Response.json({
    modelVersion: 'gemini-3.8-flash-001',
    candidates: [{ content: { parts: [{ text }] } }],
    usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 200, thoughtsTokenCount: 300 },
  });
const openRouterAnswer = () =>
  Response.json({
    model: 'deepseek/deepseek-v4-flash',
    provider: 'DeepInfra',
    choices: [{ message: { content: '{"from":"openrouter"}' } }],
    usage: { cost: 0.001, prompt_tokens: 50, completion_tokens: 20 },
  });

interface Harness {
  runtime: ReturnType<typeof createBulkLlmRuntime>;
  vertexCalls: Array<{ url: string; body: { generationConfig: { maxOutputTokens: number } } }>;
  openRouterCalls: number;
  tokenCalls: number;
  events: BulkLlmChannelEvent[];
}

function harness(
  handlers: { vertex?: () => Response | Promise<Response>; openRouter?: () => Response },
  env: Record<string, string> = {},
  vertex: VertexConfig | null = VERTEX,
  now?: () => number,
): Harness {
  const dir = mkdtempSync(join(tmpdir(), 'bulk-vertex-'));
  dirs.push(dir);
  const state: Harness = {
    vertexCalls: [],
    openRouterCalls: 0,
    tokenCalls: 0,
    events: [],
  } as unknown as Harness;
  const transport = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.includes('oauth2.googleapis.com')) {
      state.tokenCalls += 1;
      return Response.json({ access_token: 'tok', expires_in: 3600 });
    }
    if (url.includes('aiplatform.googleapis.com')) {
      state.vertexCalls.push({ url, body: JSON.parse(String(init?.body)) });
      return (handlers.vertex ?? (() => vertexAnswer()))();
    }
    state.openRouterCalls += 1;
    return (handlers.openRouter ?? openRouterAnswer)();
  }) as typeof fetch;
  state.runtime = createBulkLlmRuntime({
    databasePath: join(dir, 'app.db'),
    transport,
    env: { ...baseEnv, ...env },
    delay: async () => {},
    random: () => 0,
    ...(now ? { now } : {}),
    vertex,
    vertexToken: async () => 'tok',
    onEvent: (event) => state.events.push(event),
  });
  return state;
}

describe('Vertex first stage of the bulk channel', () => {
  it('answers from Vertex, books a gemini row with thoughts and asks OpenRouter nothing', async () => {
    const h = harness({});
    const result = await h.runtime.client!.complete({ ...req, maxTokens: 1000 });
    expect(result).toMatchObject({
      content: '{"ok":true}',
      provider: 'vertex',
      model: 'gemini-3.8-flash-001',
    });
    expect(result.fallbackReason).toBeUndefined();
    expect(h.openRouterCalls).toBe(0);
    const config = h.vertexCalls[0]!.body.generationConfig;
    expect(config).toMatchObject({
      responseMimeType: 'application/json',
      temperature: 0,
      thinkingConfig: { thinkingLevel: 'low' },
    });
    expect(config.maxOutputTokens).toBeGreaterThan(1000);
    const row = h.runtime.ledger.db
      .prepare(
        'SELECT task,provider,model,status,failure,prompt_tokens,completion_tokens,cost FROM bulk_llm_spend',
      )
      .get() as Record<string, unknown>;
    expect(row).toMatchObject({
      task: 'requirements',
      provider: 'gemini',
      model: 'gemini-3.8-flash-001',
      status: 'settled',
      failure: null,
      prompt_tokens: 1000,
      completion_tokens: 500,
    });
    expect(result.usage.cost).toBeCloseTo((1000 * 0.825 + 500 * 4.125) / 1e6, 9);
    h.runtime.close();
  });

  it('a large input that OpenRouter would refuse (reserved budget) goes through Vertex', async () => {
    const h = harness({});
    const result = await h.runtime.client!.complete({ ...req, input: 'x'.repeat(400_000) });
    expect(result.provider).toBe('vertex');
    expect(h.openRouterCalls).toBe(0);
    h.runtime.close();
  });

  it('an input over 500 000 bytes is not sent to Vertex and meets the OpenRouter bound as an ordinary error', async () => {
    const h = harness({});
    const error = await h.runtime
      .client!.complete({ ...req, input: 'x'.repeat(600_000) })
      .catch((e: unknown) => e);
    expect(h.vertexCalls).toHaveLength(0);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(BulkChannelUnavailable);
    expect((error as Error).message).toBe('Request exceeds reserved budget');
    h.runtime.close();
  });

  it('Vertex spend above the channel day cap neither closes the channel nor touches the latch', async () => {
    const h = harness(
      {},
      { OPENQAREER_VERTEX_CREDIT_USD: '1000', OPENQAREER_VERTEX_DAY_USD: '1000' },
    );
    // One row: 200 times the channel's day cap of $0.1, without a disk write per call under CI load.
    h.runtime.ledger.recordGeminiCall(
      { task: 'x', model: 'gemini-3.8-flash' },
      { cost: 20, promptTokens: 1, cachedTokens: 0, completionTokens: 1 },
    );
    await h.runtime.client!.complete(req);
    expect(h.runtime.status().spentUsd).toBe(0);
    expect(h.runtime.status().dayRemainingUsd).toBeCloseTo(0.1, 9);
    expect(h.runtime.status().events.map((event) => event.kind)).toEqual([]);
    // OpenRouter still works afterwards when Vertex is not asked.
    const second = harness({}, { OPENQAREER_VERTEX_CREDIT_UNTIL: '2020-01-01' });
    const viaOpenRouter = await second.runtime.client!.complete(req);
    expect(viaOpenRouter.model).toContain('deepseek');
    h.runtime.close();
    second.runtime.close();
  });

  it('a refusal books a rejected row, moves to OpenRouter and Vertex then cools without a call', async () => {
    const h = harness({
      vertex: () => Response.json({ error: { message: 'Resource exhausted' } }, { status: 429 }),
    });
    const first = await h.runtime.client!.complete(req);
    expect(first).toMatchObject({ fallbackReason: 'vertex_429' });
    expect(first.model).toContain('deepseek');
    await h.runtime.client!.complete(req);
    expect(h.vertexCalls).toHaveLength(1);
    expect(h.openRouterCalls).toBe(2);
    expect(
      h.runtime.ledger.db
        .prepare("SELECT status,cost,failure FROM bulk_llm_spend WHERE provider='gemini'")
        .all(),
    ).toEqual([expect.objectContaining({ status: 'rejected', cost: 0 })]);
    h.runtime.close();
  });

  it('an answer that fails accept is booked settled with its real cost and answer_rejected', async () => {
    const h = harness({ vertex: () => vertexAnswer('not json') });
    const result = await h.runtime.client!.complete(req);
    expect(result.content).toBe('{"from":"openrouter"}');
    expect(result.fallbackReason).toBe('vertex_answer_rejected');
    const row = h.runtime.ledger.db
      .prepare("SELECT status,cost,failure FROM bulk_llm_spend WHERE provider='gemini'")
      .get() as { status: string; cost: number; failure: string };
    expect(row.status).toBe('settled');
    expect(row.cost).toBeGreaterThan(0);
    expect(row.failure).toBe('answer_rejected');
    h.runtime.close();
  });

  it('a consultant step marked withoutVertex goes straight to OpenRouter (owner 04.11)', async () => {
    const h = harness({});
    const result = await h.runtime.client!.complete({ ...req, withoutVertex: true });
    expect(result.content).toBe('{"from":"openrouter"}');
    expect(result.fallbackReason).toBeUndefined();
    expect(h.vertexCalls).toEqual([]);
    expect(h.tokenCalls).toBe(0);
    expect(h.openRouterCalls).toBe(1);
    h.runtime.close();
  });

  it('a closed gate makes no network call at all, token included', async () => {
    const h = harness({}, { OPENQAREER_VERTEX_CREDIT_UNTIL: '2020-01-01' });
    const result = await h.runtime.client!.complete(req);
    expect(result.fallbackReason).toBeUndefined();
    expect(h.vertexCalls).toHaveLength(0);
    expect(h.tokenCalls).toBe(0);
    expect(h.events).toEqual([]);
    h.runtime.close();
  });

  it('without a service account there is no Vertex stage', async () => {
    const h = harness({}, {}, null);
    await h.runtime.client!.complete(req);
    expect(h.vertexCalls).toHaveLength(0);
    h.runtime.close();
  });

  it('channel_down and BulkChannelUnavailable come only from the OpenRouter stages', async () => {
    const clock = { t: 0 };
    const h = harness(
      {
        vertex: () => new Response('boom', { status: 503 }),
        openRouter: () => new Response('', { status: 503 }),
      },
      {},
      VERTEX,
      () => clock.t,
    );
    await expect(h.runtime.client!.complete(req)).rejects.toBeInstanceOf(BulkChannelUnavailable);
    expect(h.events.some((event) => event.kind === 'channel_down')).toBe(false);
    clock.t = 31 * 60_000;
    await expect(h.runtime.client!.complete(req)).rejects.toBeInstanceOf(BulkChannelUnavailable);
    expect(h.events.some((event) => event.kind === 'channel_down')).toBe(true);
    h.runtime.close();
  });

  it('turning Vertex off alone does not make the channel unavailable', async () => {
    const h = harness({}, { OPENQAREER_VERTEX_CREDIT_UNTIL: '2020-01-01' });
    for (let index = 0; index < 3; index += 1) await h.runtime.client!.complete(req);
    expect(h.events).toEqual([]);
    h.runtime.close();
  });

  it('an ordinary error of body() on an OpenRouter stage after a Vertex refusal behaves as before', async () => {
    const h = harness({ vertex: () => new Response('boom', { status: 500 }) });
    await expect(
      h.runtime.client!.complete({ ...req, input: 'x'.repeat(400_000) }),
    ).rejects.toThrow('Request exceeds reserved budget');
    expect(h.vertexCalls).toHaveLength(1);
    h.runtime.close();
  });
});
