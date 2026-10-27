import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBulkLlmRuntime } from './bulkLlmRuntime';
import type { BulkFallback } from './bulkGeminiFallback';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

const env = {
  OPENQAREER_OPENROUTER_API_KEY: 'secret',
  OPENQAREER_BULK_LLM_ENABLED: 'true',
  OPENQAREER_BULK_LLM_MODEL: 'deepseek/deepseek-v4-flash',
  OPENQAREER_BULK_LLM_PROVIDER: 'open-inference/fp4',
  OPENQAREER_BULK_LLM_QUANTIZATION: 'fp4',
  OPENQAREER_BULK_LLM_RUN_USD: '0.1',
  OPENQAREER_BULK_LLM_DAY_USD: '0.1',
  OPENQAREER_BULK_LLM_TOTAL_USD: '0.1',
  OPENQAREER_BULK_LLM_REQUEST_USD: '0.06',
  OPENQAREER_BULK_LLM_INPUT_PER_MILLION_USD: '0.01',
  OPENQAREER_BULK_LLM_OUTPUT_PER_MILLION_USD: '0.2',
};
const req = {
  runId: 'run',
  task: 'requirements',
  dataClass: 'public' as const,
  prefix: 'p',
  input: 'v',
};
const ok = () =>
  Response.json({
    model: 'deepseek/deepseek-v4-flash',
    provider: 'OpenInference',
    choices: [{ message: { content: '{"from":"openrouter"}' } }],
    usage: { cost: 0.001, prompt_tokens: 5, completion_tokens: 5 },
  });

function setup(transport: typeof fetch) {
  const dir = mkdtempSync(join(tmpdir(), 'bulk-fb-'));
  dirs.push(dir);
  const clock = { now: 1_000_000 };
  const fallback: BulkFallback = {
    provider: 'gemini',
    model: 'gemini-3.8-flash',
    inputPerMillionUsd: 0.5,
    outputPerMillionUsd: 3,
    complete: vi.fn(async () => ({
      content: '{"from":"gemini"}',
      model: 'gemini-3.8-flash',
      usage: { cost: 0.0002, promptTokens: 10, cachedTokens: 0, completionTokens: 20 },
    })),
  };
  const events: Array<{ kind: string; reason?: string }> = [];
  const runtime = createBulkLlmRuntime({
    databasePath: join(dir, 'app.db'),
    env,
    transport,
    delay: async () => {},
    fallback,
    now: () => clock.now,
    onEvent: (event) => events.push(event),
  });
  return { runtime, fallback, clock, events };
}

it('402 switches to Gemini, releases the hold and returns to OpenRouter after 10 minutes', async () => {
  let status = 402;
  const transport = vi.fn(async () =>
    status === 200 ? ok() : new Response('{}', { status }),
  ) as unknown as typeof fetch;
  const { runtime, fallback, clock, events } = setup(transport);

  const first = await runtime.client!.complete(req);
  expect(first.provider).toBe('gemini');
  expect(first.content).toBe('{"from":"gemini"}');
  expect(first.fallbackReason).toBe('openrouter_402');
  expect(events).toContainEqual({ kind: 'balance_exhausted', reason: 'openrouter_402' });
  const rows = runtime.ledger.db
    .prepare('SELECT provider,status,cost FROM bulk_llm_spend ORDER BY created_at')
    .all() as Array<{ provider: string; status: string; cost: number }>;
  expect(rows).toEqual(
    expect.arrayContaining([
      { provider: 'open-inference/fp4', status: 'rejected', cost: 0 },
      { provider: 'gemini', status: 'settled', cost: 0.0002 },
    ]),
  );

  // Within 10 minutes OpenRouter is not probed again.
  await runtime.client!.complete(req);
  expect(transport).toHaveBeenCalledTimes(1);

  status = 200;
  clock.now += 10 * 60_000 + 1;
  const back = await runtime.client!.complete(req);
  expect(back.provider).toBe('OpenInference');
  expect(back.fallbackReason).toBeUndefined();
  expect(fallback.complete).toHaveBeenCalledTimes(2);
  expect(runtime.status().spentUsd).toBeCloseTo(0.0014);
});

it.each([
  [500, 'openrouter_500'],
  [429, 'openrouter_429'],
])('status %s after retries falls back with reason %s and frees the hold', async (code, reason) => {
  const { runtime } = setup(
    (async () => new Response('{}', { status: code })) as unknown as typeof fetch,
  );
  const result = await runtime.client!.complete(req);
  expect(result.fallbackReason).toBe(reason);
  expect(runtime.status().heldUsd).toBe(0);
});

it('a timeout falls back and frees the hold', async () => {
  const { runtime } = setup((async () => {
    throw new DOMException('timed out', 'TimeoutError');
  }) as unknown as typeof fetch);
  const result = await runtime.client!.complete(req);
  expect(result.fallbackReason).toBe('openrouter_timeout');
  expect(runtime.status().heldUsd).toBe(0);
});

it('a 400 is a request error, not an outage: no fallback, hold freed', async () => {
  const { runtime, fallback } = setup(
    (async () => new Response('{}', { status: 400 })) as unknown as typeof fetch,
  );
  await expect(runtime.client!.complete(req)).rejects.toThrow('Bulk provider status 400');
  expect(fallback.complete).not.toHaveBeenCalled();
  expect(runtime.status().heldUsd).toBe(0);
});

it('a failed fallback call also frees its hold', async () => {
  const { runtime, fallback } = setup(
    (async () => new Response('{}', { status: 402 })) as unknown as typeof fetch,
  );
  vi.mocked(fallback.complete).mockRejectedValueOnce(new Error('Bulk fallback status 503'));
  await expect(runtime.client!.complete(req)).rejects.toThrow('Bulk fallback status 503');
  expect(runtime.status().heldUsd).toBe(0);
});
