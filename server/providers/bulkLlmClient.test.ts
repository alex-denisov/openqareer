import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBulkLlmRuntime } from './bulkLlmRuntime';
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));
function options(transport: typeof fetch) {
  const dir = mkdtempSync(join(tmpdir(), 'bulk-'));
  dirs.push(dir);
  return {
    databasePath: join(dir, 'app.db'),
    transport,
    env: {
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
    },
  };
}
const req = {
  runId: 'run',
  task: 'requirements',
  dataClass: 'public' as const,
  prefix: 'stable',
  input: 'vacancy',
};
function response(cost: number) {
  return Response.json({
    model: 'deepseek/deepseek-v4-flash',
    provider: 'OpenInference',
    choices: [{ message: { content: '{}' } }],
    usage: {
      cost,
      prompt_tokens: 50,
      completion_tokens: 20,
      prompt_tokens_details: { cached_tokens: 10 },
    },
  });
}
it('accounts actual cost and pins privacy, routing and reasoning', async () => {
  let body: { provider: unknown; reasoning: unknown; messages: Array<{ content: string }> };
  const runtime = createBulkLlmRuntime(
    options((async (_u, init) => {
      body = JSON.parse(String(init?.body));
      return response(0.013);
    }) as typeof fetch),
  );
  const result = await runtime.client!.complete({ ...req, dataClass: 'candidate' });
  expect(result.usage.cost).toBe(0.013);
  expect(runtime.status().spentUsd).toBe(0.013);
  expect(body!.provider).toMatchObject({
    only: ['open-inference/fp4'],
    allow_fallbacks: false,
    data_collection: 'deny',
    quantizations: ['fp4'],
  });
  expect(body!.reasoning).toEqual({ enabled: false });
  expect(body!.messages[0].content).toBe('stable');
  runtime.close();
});
it('holds concurrent and unknown charges durably across restart', async () => {
  let release!: (r: Response) => void;
  let calls = 0;
  const opts = options((async () => {
    calls++;
    return new Promise<Response>((r) => {
      release = r;
    });
  }) as typeof fetch);
  const a = createBulkLlmRuntime(opts);
  const pending = a.client!.complete(req);
  await expect(a.client!.complete(req)).rejects.toThrow('budget');
  release(Response.json({ choices: [{ message: { content: '{}' } }] }));
  await expect(pending).rejects.toThrow('usage');
  a.close();
  const b = createBulkLlmRuntime(opts);
  await expect(b.client!.complete(req)).rejects.toThrow('budget');
  expect(calls).toBe(1);
  expect(b.status().heldUsd).toBe(0.06);
  expect(b.status().events.length).toBeGreaterThan(0);
  b.close();
});
it('is disabled without fully explicit controls', () => {
  const runtime = createBulkLlmRuntime({ ...options(fetch), env: {} });
  expect(runtime.client).toBeNull();
  runtime.close();
});
it('bounded 429 retries retain one reservation and stable prefix', async () => {
  let calls = 0;
  const delays: number[] = [];
  const opts = options((async () =>
    ++calls < 3
      ? new Response('', { status: 429, headers: { 'retry-after': '999999' } })
      : response(0.02)) as typeof fetch);
  const runtime = createBulkLlmRuntime({
    ...opts,
    delay: async (ms) => {
      delays.push(ms);
    },
  });
  await runtime.client!.complete(req);
  expect(calls).toBe(3);
  expect(delays).toEqual([5000, 5000]);
  expect(runtime.status().spentUsd).toBe(0.02);
  expect(runtime.status().heldUsd).toBe(0);
  runtime.close();
});
it('enforces aggregate reservations across separate database connections', async () => {
  let release!: (r: Response) => void;
  const opts = options(
    (async () =>
      new Promise<Response>((r) => {
        release = r;
      })) as typeof fetch,
  );
  const a = createBulkLlmRuntime(opts);
  const b = createBulkLlmRuntime(opts);
  const pending = a.client!.complete(req);
  await expect(b.client!.complete({ ...req, runId: 'other' })).rejects.toThrow('budget');
  release(response(0.02));
  await pending;
  expect(b.status().spentUsd).toBe(0.02);
  a.close();
  b.close();
});
it('batch rejects candidate content, persists async holds and settles exactly once', async () => {
  let calls = 0;
  const opts = options((async (_url, init) => {
    calls++;
    if (init?.method === 'POST')
      return Response.json({ id: 'batch_123', status: 'validating' }, { status: 202 });
    return Response.json({
      status: 'completed',
      usage: { cost: 0.03, prompt_tokens: 100, completion_tokens: 10 },
      results: [],
    });
  }) as typeof fetch);
  opts.env = { ...opts.env, OPENQAREER_BULK_LLM_BATCH_ENABLED: 'true' } as typeof opts.env;
  const runtime = createBulkLlmRuntime(opts);
  await expect(runtime.client!.submitBatch([{ ...req, dataClass: 'candidate' }])).rejects.toThrow(
    'public',
  );
  expect(calls).toBe(0);
  const batch = await runtime.client!.submitBatch([req]);
  expect(runtime.status().heldUsd).toBe(0.06);
  expect(runtime.status().spentUsd).toBe(0);
  await runtime.client!.pollBatch(batch.reservationId);
  await runtime.client!.pollBatch(batch.reservationId);
  expect(runtime.status().spentUsd).toBe(0.03);
  runtime.close();
});
it('rejects unsupported reasoning models and oversized request before transport', async () => {
  let calls = 0;
  const opts = options((async () => {
    calls++;
    return response(0.01);
  }) as typeof fetch);
  expect(() =>
    createBulkLlmRuntime({
      ...opts,
      env: { ...opts.env, OPENQAREER_BULK_LLM_MODEL: 'google/gemini-3.8-flash' },
    }),
  ).toThrow('disabled reasoning');
  const runtime = createBulkLlmRuntime(opts);
  await expect(runtime.client!.complete({ ...req, input: 'x'.repeat(7000000) })).rejects.toThrow(
    'reserved budget',
  );
  expect(calls).toBe(0);
  runtime.close();
});
it('an upstream cost above reservation records actual charge and stops later dispatches', async () => {
  let calls = 0;
  const opts = options((async () => {
    calls++;
    return response(0.07);
  }) as typeof fetch);
  opts.env.OPENQAREER_BULK_LLM_TOTAL_USD = '1';
  opts.env.OPENQAREER_BULK_LLM_DAY_USD = '1';
  opts.env.OPENQAREER_BULK_LLM_RUN_USD = '1';
  const runtime = createBulkLlmRuntime(opts);
  await expect(runtime.client!.complete(req)).rejects.toThrow('Actual cost');
  expect(runtime.status().spentUsd).toBe(0.07);
  await expect(runtime.client!.complete(req)).rejects.toThrow('budget');
  expect(calls).toBe(1);
  runtime.close();
});
it('routes through an ordered list of pinned providers so one price change or rate limit does not stop the work', async () => {
  let body: { provider: { order: string[]; only: string[]; allow_fallbacks: boolean; quantizations: string[] } };
  const base = options((async (_u, init) => {
    body = JSON.parse(String(init?.body));
    return response(0.001);
  }) as typeof fetch);
  const runtime = createBulkLlmRuntime({
    ...base,
    env: {
      ...base.env,
      OPENQAREER_BULK_LLM_PROVIDER: 'streamlake/fp8,deepinfra/fp8',
      OPENQAREER_BULK_LLM_QUANTIZATION: 'fp8',
    },
  });
  await runtime.client!.complete(req);
  expect(body!.provider).toMatchObject({
    order: ['streamlake/fp8', 'deepinfra/fp8'],
    only: ['streamlake/fp8', 'deepinfra/fp8'],
    allow_fallbacks: true,
    quantizations: ['fp8'],
  });
  runtime.close();
});
it('expires a hold left by a call that never settled after the TTL at the dearest settled call of its task, not at the cap (B556)', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  try {
    vi.setSystemTime(Date.parse('2026-10-22T03:00:00.000Z'));
    let mode: 'ok' | 'timeout' = 'ok';
    const opts = options((async () => {
      if (mode === 'timeout') throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
      return response(0.004);
    }) as typeof fetch);
    const runtime = createBulkLlmRuntime(opts);
    await runtime.client!.complete(req);
    mode = 'timeout';
    await expect(runtime.client!.complete(req)).rejects.toThrow('timeout');
    expect(runtime.status().heldUsd).toBe(0.06);
    mode = 'ok';
    // Inside the TTL the hold still blocks: the charge may yet be real.
    await expect(runtime.client!.complete(req)).rejects.toThrow('budget');
    vi.setSystemTime(Date.parse('2026-10-22T03:16:00.000Z'));
    await runtime.client!.complete(req);
    const status = runtime.status();
    expect(status.heldUsd).toBe(0);
    expect(status.spentUsd).toBeCloseTo(0.012, 6);
    runtime.close();
  } finally {
    vi.useRealTimers();
  }
});
