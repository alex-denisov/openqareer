import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBulkLlmRuntime } from './bulkLlmRuntime';
import { bulkOpenRouterLanes } from './bulkLlmConfig';
import { BulkChannelUnavailable, CHANNEL_DOWN_ALERT_MS, type BulkLlmChannelEvent } from './bulkLlmClient';
import { MODEL_CHAINS } from './modelChains';

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

function setup(transport: ReturnType<typeof openRouter>) {
  const dir = mkdtempSync(join(tmpdir(), 'bulk-chain-'));
  dirs.push(dir);
  const clock = { now: 1_000_000 };
  const pauses: number[] = [];
  const events: BulkLlmChannelEvent[] = [];
  const runtime = createBulkLlmRuntime({
    databasePath: join(dir, 'app.db'),
    env,
    transport: transport as unknown as typeof fetch,
    delay: async (ms) => {
      pauses.push(ms);
    },
    random: () => 0.5,
    now: () => clock.now,
    onEvent: (event) => events.push(event),
  });
  return { runtime, clock, events, pauses };
}
const rows = (runtime: ReturnType<typeof setup>['runtime']) =>
  runtime.ledger.db
    .prepare('SELECT model,status,failure FROM bulk_llm_spend ORDER BY created_at,rowid')
    .all() as { model: string; status: string; failure: string | null }[];

describe('фон: Vertex первым, затем OpenRouter (решение владельца 04.11)', () => {
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

  it('Vertex - первая ступень фоновой цепочки, за ним две ступени OpenRouter', () => {
    expect(MODEL_CHAINS.bulk.map((stage) => stage.provider)).toEqual([
      'vertex',
      'openrouter',
      'openrouter',
    ]);
  });

  it('deepseek-v4-flash — голова: ответил он, больше никто не зовётся', async () => {
    const transport = openRouter({});
    const { runtime, pauses } = setup(transport);
    const result = await runtime.client!.complete(req);
    expect(result.model).toBe(HEAD);
    expect(result.fallbackReason).toBeUndefined();
    expect(modelsCalled(transport)).toEqual([HEAD]);
    expect(pauses).toEqual([]);
  });

  it('5xx: три попытки deepseek с паузой и сменой первого хоста, потом glm', async () => {
    const transport = openRouter({ [HEAD]: 503 });
    const { runtime, pauses, events } = setup(transport);
    const result = await runtime.client!.complete(req);
    expect(modelsCalled(transport)).toEqual([HEAD, HEAD, HEAD, GLM]);
    expect(pauses).toEqual([750, 1_500]);
    const firstHosts = transport.mock.calls.slice(0, 3).map(([, init]) => {
      const body = JSON.parse(String(init?.body)) as { provider: { order: string[]; only: string[] } };
      expect(body.provider.only).toEqual(['streamlake/fp8', 'deepinfra/fp8', 'gmicloud/fp8']);
      return body.provider.order[0];
    });
    expect(firstHosts).toEqual(['streamlake/fp8', 'deepinfra/fp8', 'gmicloud/fp8']);
    expect(result).toMatchObject({ model: GLM, fallbackReason: 'openrouter_503' });
    expect(events).toEqual([{ kind: 'fallback', reason: 'openrouter_503' }]);
  });

  it('разовый сбой: вторая попытка отвечает, ступень не остывает', async () => {
    let calls = 0;
    const answer = openRouter({});
    const transport = vi.fn(async (url: string, init?: RequestInit) => {
      calls += 1;
      if (calls === 1) return new Response('{}', { status: 502 });
      return answer(url, init);
    });
    const { runtime, events } = setup(transport as never);
    expect((await runtime.client!.complete(req)).model).toBe(HEAD);
    expect(events).toEqual([]);
    await runtime.client!.complete(req);
    expect(calls).toBe(3);
  });

  it('остывшая голова пропускается 10 минут, затем спрашивается снова', async () => {
    const transport = openRouter({ [HEAD]: 500 });
    const { runtime, clock } = setup(transport);
    await runtime.client!.complete(req);
    transport.mockClear();
    await runtime.client!.complete(req);
    expect(modelsCalled(transport)).toEqual([GLM]);
    clock.now += 10 * 60_000 + 1;
    transport.mockClear();
    await runtime.client!.complete(req);
    expect(modelsCalled(transport)[0]).toBe(HEAD);
  });

  it('400 повторять незачем: сразу к glm, голова не остывает', async () => {
    const transport = openRouter({ [HEAD]: 400 });
    const { runtime, events } = setup(transport);
    expect((await runtime.client!.complete(req)).model).toBe(GLM);
    expect(modelsCalled(transport)).toEqual([HEAD, GLM]);
    expect(events).toEqual([]);
  });

  it('402: без повторов, владельцу уходит событие о балансе', async () => {
    const transport = openRouter({ [HEAD]: 402, [GLM]: 402 });
    const { runtime, events } = setup(transport);
    await expect(runtime.client!.complete(req)).rejects.toBeInstanceOf(BulkChannelUnavailable);
    expect(modelsCalled(transport)).toEqual([HEAD, GLM]);
    expect(events.filter((event) => event.kind === 'balance_exhausted')).toHaveLength(2);
  });

  it('негодный ответ оплачен: две попытки на ступень, не больше', async () => {
    const transport = openRouter({});
    const { runtime } = setup(transport);
    await expect(
      runtime.client!.complete({ ...req, accept: () => false }),
    ).rejects.toThrow('Bulk answer rejected');
    expect(modelsCalled(transport)).toEqual([HEAD, HEAD, GLM, GLM]);
    expect(rows(runtime).every((row) => row.status === 'settled')).toBe(true);
  });

  it('негодный ответ головы, годный у glm', async () => {
    const transport = openRouter({});
    const { runtime } = setup(transport);
    const result = await runtime.client!.complete({
      ...req,
      accept: (content) => content.includes(GLM),
    });
    expect(result).toMatchObject({ model: GLM, fallbackReason: 'answer_rejected' });
  });

  it('тело ответа не дошло: удержание снято, причина записана, идём к glm', async () => {
    const answer = openRouter({});
    const transport = vi.fn(async (url: string, init?: RequestInit) => {
      const model = (JSON.parse(String(init?.body)) as { model: string }).model;
      if (model !== HEAD) return answer(url, init);
      return { ok: true, status: 200, json: async () => { throw Object.assign(new Error('t'), { name: 'TimeoutError' }); } } as unknown as Response;
    });
    const { runtime } = setup(transport as never);
    expect((await runtime.client!.complete(req)).model).toBe(GLM);
    expect(rows(runtime)[0]).toMatchObject({ status: 'rejected', failure: 'openrouter_body_timeout' });
    expect(runtime.status().heldUsd).toBe(0);
  });

  it('200 с ошибкой хоста вместо ответа: удержание снято, повтор', async () => {
    let calls = 0;
    const answer = openRouter({});
    const transport = vi.fn(async (url: string, init?: RequestInit) => {
      calls += 1;
      if (calls === 1) return Response.json({ error: { message: 'Provider returned error', code: 502 } });
      return answer(url, init);
    });
    const { runtime } = setup(transport as never);
    expect((await runtime.client!.complete(req)).model).toBe(HEAD);
    expect(rows(runtime)[0]).toMatchObject({ status: 'rejected', failure: 'upstream: Provider returned error' });
    expect(runtime.status().heldUsd).toBe(0);
  });

  it('всё недоступно: BulkChannelUnavailable, удержаний нет', async () => {
    const transport = openRouter({ [HEAD]: 500, [GLM]: 503 });
    const { runtime } = setup(transport);
    const failure = await runtime.client!.complete(req).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(BulkChannelUnavailable);
    expect((failure as Error).message).toContain('503');
    expect(runtime.status().heldUsd).toBe(0);
  });

  it('недоступность дольше 30 минут: событие владельцу; ответ сбрасывает отсчёт', async () => {
    const transport = openRouter({ [HEAD]: 500, [GLM]: 503 });
    const { runtime, clock, events } = setup(transport);
    const down = () => events.filter((event) => event.kind === 'channel_down');
    await runtime.client!.complete(req).catch(() => undefined);
    clock.now += CHANNEL_DOWN_ALERT_MS - 1;
    await runtime.client!.complete(req).catch(() => undefined);
    expect(down()).toHaveLength(0);
    clock.now += 2;
    await runtime.client!.complete(req).catch(() => undefined);
    expect(down()).toEqual([{ kind: 'channel_down', reason: 'openrouter_503' }]);
  });

  it('исчерпанный бюджет останавливает цепочку, а не перебирает её', async () => {
    const transport = openRouter({});
    const { runtime } = setup(transport);
    runtime.ledger.reserve({ ...req, model: 'm', provider: 'p' }, {
      runUsd: 0.1,
      dayUsd: 0.1,
      monthUsd: 0.1,
      perRequestUsd: 0.1,
    } as never);
    await expect(runtime.client!.complete(req)).rejects.toThrow('budget');
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

describe('glm-5.3-flash и причина отказа (04.11)', () => {
  it('glm получает обязательное рассуждение low, deepseek — выключенное', async () => {
    const transport = openRouter({ [HEAD]: 400 });
    const { runtime } = setup(transport);
    await runtime.client!.complete(req);
    const reasoning = transport.mock.calls.map(
      ([, init]) => (JSON.parse(String(init?.body)) as { reasoning: unknown }).reasoning,
    );
    expect(reasoning).toEqual([{ enabled: false }, { effort: 'low' }]);
  });

  it('отказ провайдера хранит его сообщение в журнале, ключей в нём нет', async () => {
    const answer = openRouter({});
    const transport = vi.fn(async (url: string, init?: RequestInit) => {
      const model = (JSON.parse(String(init?.body)) as { model: string }).model;
      if (model === HEAD) {
        return Response.json(
          { error: { message: 'Reasoning is mandatory, sk-abcdefghijklmnop' } },
          { status: 400 },
        );
      }
      return answer(url, init);
    });
    const { runtime } = setup(transport as never);
    await runtime.client!.complete(req);
    expect(rows(runtime)[0]?.failure).toBe('status 400: Reasoning is mandatory, [masked]');
  });

  it('сбой транспорта оставляет причину', async () => {
    const transport = vi.fn(async () => {
      throw Object.assign(new Error('t'), { name: 'TimeoutError' });
    });
    const { runtime } = setup(transport as never);
    await expect(runtime.client!.complete(req)).rejects.toBeInstanceOf(BulkChannelUnavailable);
    expect(rows(runtime).map((row) => row.failure)).toEqual(['openrouter_timeout', 'openrouter_timeout']);
  });
});
