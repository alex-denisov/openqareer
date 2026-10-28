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
const DEEPSEEK = 'deepseek/deepseek-v4.1-flash';
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

describe('цепочка массового канала (28.10)', () => {
  it('OpenRouter-ступени цепочки — deepseek-v4.1-flash, затем glm-5.3-flash, с закреплёнными хостами', () => {
    expect(bulkOpenRouterLanes()).toEqual([
      {
        model: DEEPSEEK,
        provider: 'deepinfra/fp8,baidu/fp8,morph/fp8',
        quantization: 'fp8',
        inputPerMillionUsd: 0.14,
        outputPerMillionUsd: 0.42,
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

  it('Vertex — голова: ответил он, OpenRouter не зовётся', async () => {
    const transport = openRouter({});
    const { runtime } = setup(transport);
    const result = await runtime.client!.complete(req);
    expect(result).toMatchObject({ provider: 'gemini', content: '{"from":"vertex"}' });
    expect(result.fallbackReason).toBeUndefined();
    expect(transport).not.toHaveBeenCalled();
  });

  it('429 у Vertex ведёт к deepseek, Vertex остывает 10 минут и возвращается', async () => {
    const transport = openRouter({});
    let vertexStatus = 429;
    const { runtime, vertex, clock, events } = setup(transport, async () => {
      if (vertexStatus !== 200) throw new Error(`Bulk fallback status ${vertexStatus}`);
      return '{"from":"vertex"}';
    });

    const first = await runtime.client!.complete(req);
    expect(first).toMatchObject({ model: DEEPSEEK, fallbackReason: 'vertex_429' });
    expect(events).toContainEqual({ kind: 'fallback', reason: 'vertex_429' });

    const second = await runtime.client!.complete(req);
    expect(second).toMatchObject({ model: DEEPSEEK, fallbackReason: 'vertex_429' });
    expect(vertex.complete).toHaveBeenCalledTimes(1);

    vertexStatus = 200;
    clock.now += 10 * 60_000 + 1;
    const back = await runtime.client!.complete(req);
    expect(back.provider).toBe('gemini');
    expect(back.fallbackReason).toBeUndefined();
    expect(runtime.status().heldUsd).toBe(0);
  });

  it('Vertex и deepseek отказали (402) — отвечает glm-5.3-flash, владельцу сигнал о балансе', async () => {
    const transport = openRouter({ [DEEPSEEK]: 402 });
    const { runtime, events } = setup(transport, async () => {
      throw new Error('Bulk fallback status 503');
    });
    const result = await runtime.client!.complete(req);
    expect(result).toMatchObject({ model: GLM, fallbackReason: 'vertex_503' });
    expect(modelsCalled(transport)).toEqual([DEEPSEEK, GLM]);
    expect(events).toContainEqual({ kind: 'balance_exhausted', reason: 'openrouter_402' });
    expect(runtime.status().heldUsd).toBe(0);
  });

  it('негодный ответ Vertex ведёт к следующей ступени, но не остужает её', async () => {
    const transport = openRouter({});
    const { runtime, vertex } = setup(transport, async () => 'не JSON');
    const result = await runtime.client!.complete(req);
    expect(result).toMatchObject({ model: DEEPSEEK, fallbackReason: 'vertex_answer_rejected' });
    await runtime.client!.complete(req);
    expect(vertex.complete).toHaveBeenCalledTimes(2);
  });

  it('проверка вызывающего решает, годен ли ответ', async () => {
    const transport = openRouter({});
    const { runtime } = setup(transport);
    const result = await runtime.client!.complete({
      ...req,
      accept: (content) => content.includes(GLM),
    });
    expect(result.model).toBe(GLM);
    expect(modelsCalled(transport)).toEqual([DEEPSEEK, GLM]);
  });

  it('400 у deepseek — не авария: идём к glm, deepseek не остывает', async () => {
    const transport = openRouter({ [DEEPSEEK]: 400 });
    const { runtime } = setup(transport, async () => {
      throw new Error('Bulk fallback status 503');
    });
    expect((await runtime.client!.complete(req)).model).toBe(GLM);
    await runtime.client!.complete(req);
    expect(modelsCalled(transport)).toEqual([DEEPSEEK, GLM, DEEPSEEK, GLM]);
  });

  it('все ступени отказали — ошибка последней, удержания сняты', async () => {
    const transport = openRouter({ [DEEPSEEK]: 500, [GLM]: 503 });
    const { runtime } = setup(transport, async () => {
      throw new DOMException('timed out', 'TimeoutError');
    });
    await expect(runtime.client!.complete(req)).rejects.toThrow('Bulk provider status 503');
    expect(runtime.status().heldUsd).toBe(0);
  });

  it('исчерпанный бюджет останавливает цепочку, а не перебирает её', async () => {
    const transport = openRouter({});
    const { runtime, vertex } = setup(transport);
    runtime.ledger.reserve({ ...req, model: 'm', provider: 'p' }, {
      runUsd: 0.1,
      dayUsd: 0.1,
      totalUsd: 0.1,
      perRequestUsd: 0.1,
    } as never);
    await expect(runtime.client!.complete(req)).rejects.toThrow('budget');
    expect(vertex.complete).not.toHaveBeenCalled();
    expect(transport).not.toHaveBeenCalled();
  });
});
