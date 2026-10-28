import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBulkLlmRuntime } from './bulkLlmRuntime';
import { bulkOpenRouterLanes } from './bulkLlmConfig';
import type { BulkFallback } from './bulkGeminiFallback';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

const env = {
  OPENQAREER_OPENROUTER_API_KEY: 'secret',
  OPENQAREER_BULK_LLM_ENABLED: 'true',
  OPENQAREER_BULK_LLM_RUN_USD: '0.1',
  OPENQAREER_BULK_LLM_DAY_USD: '0.1',
  OPENQAREER_BULK_LLM_TOTAL_USD: '0.1',
  OPENQAREER_BULK_LLM_REQUEST_USD: '0.06',
};
const req = {
  runId: 'run',
  task: 'requirements',
  dataClass: 'public' as const,
  prefix: 'p',
  input: 'v',
};
const HEAD = 'deepseek/deepseek-v4-flash';
const GLM = 'z-ai/glm-5.3-flash';

/** OpenRouter answers per model: a status, or 200 with `{"from": model}`. */
function openRouter(statuses: Record<string, number>) {
  return vi.fn(async (_url: string, init?: RequestInit) => {
    const model = (JSON.parse(String(init?.body)) as { model: string }).model;
    const status = statuses[model] ?? 200;
    if (status !== 200) return new Response('{}', { status });
    return Response.json({
      model,
      provider: 'Host',
      choices: [{ message: { content: JSON.stringify({ from: model }) } }],
      usage: { cost: 0.001, prompt_tokens: 5, completion_tokens: 5 },
    });
  });
}
const modelsCalled = (transport: ReturnType<typeof openRouter>) =>
  transport.mock.calls.map(
    ([, init]) => (JSON.parse(String(init?.body)) as { model: string }).model,
  );

function setup(transport: ReturnType<typeof openRouter>, vertexAnswer?: () => Promise<string>) {
  const dir = mkdtempSync(join(tmpdir(), 'bulk-chain-'));
  dirs.push(dir);
  const clock = { now: 1_000_000 };
  const vertex: BulkFallback = {
    provider: 'gemini',
    model: 'gemini-3.8-flash',
    inputPerMillionUsd: 0.5,
    outputPerMillionUsd: 3,
    complete: vi.fn(async () => ({
      content: vertexAnswer ? await vertexAnswer() : '{"from":"vertex"}',
      model: 'gemini-3.8-flash',
      usage: { cost: 0.0002, promptTokens: 10, cachedTokens: 0, completionTokens: 20 },
    })),
  };
  const events: Array<{ kind: string; reason?: string }> = [];
  const runtime = createBulkLlmRuntime({
    databasePath: join(dir, 'app.db'),
    env,
    transport: transport as unknown as typeof fetch,
    delay: async () => {},
    vertex,
    now: () => clock.now,
    onEvent: (event) => events.push(event),
  });
  return { runtime, vertex, clock, events };
}

describe('цепочка массового канала (B580, 29.10): Vertex последним', () => {
  it('OpenRouter-ступени цепочки — deepseek-v4-flash, затем glm-5.3-flash, с закреплёнными хостами', () => {
    expect(bulkOpenRouterLanes()).toEqual([
      {
        model: HEAD,
        provider: 'streamlake/fp8,deepinfra/fp8,gmicloud/fp8',
        quantization: 'fp8',
        inputPerMillionUsd: 0.15,
        outputPerMillionUsd: 0.3,
      },
      {
        model: GLM,
        provider: 'streamlake/fp8,gmicloud/fp8,novita/fp8',
        quantization: 'fp8',
        inputPerMillionUsd: 0.15,
        outputPerMillionUsd: 0.5,
      },
    ]);
  });

  it('deepseek-v4-flash — голова: ответил он, glm и Vertex не зовутся', async () => {
    const transport = openRouter({});
    const { runtime, vertex } = setup(transport);
    const result = await runtime.client!.complete(req);
    expect(result).toMatchObject({ model: HEAD, content: JSON.stringify({ from: HEAD }) });
    expect(result.fallbackReason).toBeUndefined();
    expect(modelsCalled(transport)).toEqual([HEAD]);
    expect(vertex.complete).not.toHaveBeenCalled();
  });

  it('авария головы ведёт к glm, голова остывает 10 минут и возвращается', async () => {
    const statuses: Record<string, number> = { [HEAD]: 503 };
    const transport = openRouter(statuses);
    const { runtime, clock, events } = setup(transport);

    const first = await runtime.client!.complete(req);
    expect(first).toMatchObject({ model: GLM, fallbackReason: 'openrouter_503' });
    expect(events).toContainEqual({ kind: 'fallback', reason: 'openrouter_503' });
    const headCalls = modelsCalled(transport).filter((model) => model === HEAD).length;

    const second = await runtime.client!.complete(req);
    expect(second).toMatchObject({ model: GLM, fallbackReason: 'openrouter_503' });
    expect(modelsCalled(transport).filter((model) => model === HEAD)).toHaveLength(headCalls);

    statuses[HEAD] = 200;
    clock.now += 10 * 60_000 + 1;
    const back = await runtime.client!.complete(req);
    expect(back.model).toBe(HEAD);
    expect(back.fallbackReason).toBeUndefined();
    expect(runtime.status().heldUsd).toBe(0);
  });

  it('обе OpenRouter-ступени отказали (402) — отвечает Vertex, владельцу сигнал о балансе', async () => {
    const transport = openRouter({ [HEAD]: 402, [GLM]: 402 });
    const { runtime, events } = setup(transport);
    const result = await runtime.client!.complete(req);
    expect(result).toMatchObject({ provider: 'gemini', fallbackReason: 'openrouter_402' });
    expect(modelsCalled(transport)).toEqual([HEAD, GLM]);
    expect(events).toContainEqual({ kind: 'balance_exhausted', reason: 'openrouter_402' });
    expect(runtime.status().heldUsd).toBe(0);
  });

  it('резерв Vertex — верхняя граница по его цене с запасом, а не плоские $0,06 (28.10)', async () => {
    const transport = openRouter({ [HEAD]: 402, [GLM]: 402 });
    const { runtime, vertex } = setup(transport);
    // Dear enough that the bound is above the flat $0.06 hold of the test env.
    Object.assign(vertex, { outputPerMillionUsd: 15 });
    await runtime.client!.complete({ ...req, maxTokens: 4096 });
    const row = runtime.ledger.db
      .prepare("SELECT reserved FROM bulk_llm_spend WHERE provider='gemini'")
      .get() as { reserved: number };
    const bytes = Buffer.byteLength(req.prefix) + Buffer.byteLength(req.input) + 4096;
    const bound = (bytes * vertex.inputPerMillionUsd + 4096 * vertex.outputPerMillionUsd) / 1e6;
    expect(bound * 1.25).toBeGreaterThan(0.06);
    expect(row.reserved).toBeCloseTo(bound * 1.25, 9);
  });

  it('проверка вызывающего решает, годен ли ответ; негодный ответ не остужает ступень', async () => {
    const transport = openRouter({});
    const { runtime } = setup(transport);
    const result = await runtime.client!.complete({
      ...req,
      accept: (content) => content.includes(GLM),
    });
    expect(result).toMatchObject({ model: GLM, fallbackReason: 'openrouter_answer_rejected' });
    await runtime.client!.complete(req);
    expect(modelsCalled(transport)).toEqual([HEAD, GLM, HEAD]);
  });

  it('400 у головы — не авария: идём к glm, голова не остывает', async () => {
    const transport = openRouter({ [HEAD]: 400 });
    const { runtime } = setup(transport);
    expect((await runtime.client!.complete(req)).model).toBe(GLM);
    await runtime.client!.complete(req);
    expect(modelsCalled(transport)).toEqual([HEAD, GLM, HEAD, GLM]);
  });

  it('все ступени отказали — ошибка последней, удержания сняты', async () => {
    const transport = openRouter({ [HEAD]: 500, [GLM]: 503 });
    const { runtime } = setup(transport, async () => {
      throw new Error('Bulk fallback status 503');
    });
    await expect(runtime.client!.complete(req)).rejects.toThrow('503');
    expect(runtime.status().heldUsd).toBe(0);
  });

  it('исчерпанный бюджет останавливает цепочку, а не перебирает её', async () => {
    const transport = openRouter({});
    const { runtime, vertex } = setup(transport);
    runtime.ledger.reserve({ ...req, model: 'm', provider: 'p' }, {
      runUsd: 0.1,
      dayUsd: 0.1,
      monthUsd: 0.1,
      perRequestUsd: 0.1,
    } as never);
    await expect(runtime.client!.complete(req)).rejects.toThrow('budget');
    expect(vertex.complete).not.toHaveBeenCalled();
    expect(transport).not.toHaveBeenCalled();
  });
});

describe('месячный потолок в настройке (B580)', () => {
  it('OPENQAREER_BULK_LLM_MONTH_USD — потолок месяца; без него берётся прежний TOTAL_USD', async () => {
    const { readBulkLlmConfig } = await import('./bulkLlmConfig');
    expect(readBulkLlmConfig({ ...env, OPENQAREER_BULK_LLM_MONTH_USD: '25' })?.monthUsd).toBe(25);
    expect(readBulkLlmConfig(env)?.monthUsd).toBe(0.1);
  });
});
