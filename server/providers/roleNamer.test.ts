import type { RoleNamingCacheEntry, RoleNamingCacheStore } from './roleNamer';
import { describe, expect, it, vi } from 'vitest';
import type { NamedRole } from '../../shared/roleProposals';
import { HygienicRoleNamer } from './hygienicRoleNamer';
import {
  buildRoleNamer,
  CachedRoleNamer,
  describeRoleNamerQueue,
  GeminiRoleNamer,
  LlmRoleNamer,
  QueuedRoleNamer,
  type ChatCompletionClient,
  type RoleNamer,
} from './roleNamer';

function client(content: string | null): ChatCompletionClient {
  return {
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({ choices: [{ message: { content } }] }),
      },
    },
  };
}

const facts = [
  { ref: 'memory:1', statement: 'Девять лет вёл внутренние продукты' },
  { ref: 'memory:2', statement: 'Собеседовал и нанимал шесть человек' },
];

describe('LlmRoleNamer', () => {
  it('отдаёт роли, которые модель обосновала фактами', async () => {
    const namer = new LlmRoleNamer({
      apiKey: 'k',
      model: 'm',
      client: client(
        JSON.stringify({
          roles: [
            { title: 'Продакт-менеджер', reason: 'вёл продукты', evidenceRefs: ['memory:1'] },
          ],
        }),
      ),
    });

    await expect(namer.nameRoles(facts, 'ru')).resolves.toMatchObject({ roles: [
      { title: 'Продакт-менеджер', reason: 'вёл продукты', evidenceRefs: ['memory:1'] },
    ] });
  });

  it('возвращает пусто, когда модель ответила не по схеме', async () => {
    const namer = new LlmRoleNamer({ apiKey: 'k', model: 'm', client: client('не json') });
    await expect(namer.nameRoles(facts, 'ru')).resolves.toMatchObject({ roles: [] });
  });

  it('не спрашивает модель, когда фактов нет', async () => {
    const stub = client('{"roles":[]}');
    const namer = new LlmRoleNamer({ apiKey: 'k', model: 'm', client: stub });

    await expect(namer.nameRoles([], 'ru')).resolves.toMatchObject({ roles: [] });
    expect(stub.chat.completions.create).not.toHaveBeenCalled();
  });

  it('переживает отказ провайдера, не роняя маршрут', async () => {
    const namer = new LlmRoleNamer({
      apiKey: 'k',
      model: 'm',
      client: {
        chat: { completions: { create: vi.fn().mockRejectedValue(new Error('503')) } },
      },
    });

    await expect(namer.nameRoles(facts, 'ru')).resolves.toMatchObject({ roles: [] });
  });
});

describe('CachedRoleNamer', () => {
  const roles = [{ title: 'Продакт-менеджер', reason: 'вёл продукты', evidenceRefs: ['memory:1'] }];

  it('не спрашивает модель второй раз, пока факты те же', async () => {
    const inner = { nameRoles: vi.fn().mockResolvedValue({ roles, stage: 'test:stage' }) };
    const namer = new CachedRoleNamer(inner);

    await namer.nameRoles(facts, 'ru');
    await expect(namer.nameRoles(facts, 'ru')).resolves.toMatchObject({ roles: roles });
    expect(inner.nameRoles).toHaveBeenCalledTimes(1);
  });

  /**
   * INC-035: кэш жил только в памяти процесса, поэтому каждый деплой снова звал
   * модель — и упирался в исчерпанную бесплатную квоту (429).
   */
  it('переживает рестарт: второй процесс читает названное из хранилища', async () => {
    const rows = new Map<string, RoleNamingCacheEntry>();
    const store: RoleNamingCacheStore = {
      read: (key) => rows.get(key),
      write: (key, entry) => {
        rows.set(key, entry);
      },
    };

    const first = { nameRoles: vi.fn().mockResolvedValue({ roles, stage: 'test:stage' }) };
    await new CachedRoleNamer(first, { store }).nameRoles(facts, 'ru');

    // Новый процесс: своя пустая память, то же хранилище.
    const second = { nameRoles: vi.fn().mockResolvedValue({ roles, stage: 'test:stage' }) };
    await expect(
      new CachedRoleNamer(second, { store }).nameRoles(facts, 'ru'),
    ).resolves.toMatchObject({ roles, stage: 'test:stage' });
    expect(second.nameRoles).not.toHaveBeenCalled();
  });

  it('не отдаёт из хранилища то, что старше срока хранения', async () => {
    const store: RoleNamingCacheStore = {
      read: () => ({ at: 0, roles, stage: 'test:stage' }),
      write: () => undefined,
    };
    const inner = { nameRoles: vi.fn().mockResolvedValue({ roles, stage: 'fresh:stage' }) };
    const namer = new CachedRoleNamer(inner, { store, now: () => 30 * 24 * 60 * 60_000 });

    await expect(namer.nameRoles(facts, 'ru')).resolves.toMatchObject({ stage: 'fresh:stage' });
    expect(inner.nameRoles).toHaveBeenCalledTimes(1);
  });

  it('не кладёт в хранилище пустой ответ ступени', async () => {
    const write = vi.fn();
    const inner = { nameRoles: vi.fn().mockResolvedValue({ roles: [] }) };
    await new CachedRoleNamer(inner, {
      store: { read: () => undefined, write },
    }).nameRoles(facts, 'ru');

    expect(write).not.toHaveBeenCalled();
  });

  it('спрашивает заново, когда факты изменились', async () => {
    const inner = { nameRoles: vi.fn().mockResolvedValue({ roles, stage: 'test:stage' }) };
    const namer = new CachedRoleNamer(inner);

    await namer.nameRoles(facts, 'ru');
    await namer.nameRoles([...facts, { ref: 'memory:3', statement: 'Запускал маркетплейс' }], 'ru');
    expect(inner.nameRoles).toHaveBeenCalledTimes(2);
  });

  it('не запоминает отказ: пустой ответ спрашивается заново', async () => {
    const inner = { nameRoles: vi.fn().mockResolvedValue({ roles: [] }) };
    const namer = new CachedRoleNamer(inner);

    await namer.nameRoles(facts, 'ru');
    await namer.nameRoles(facts, 'ru');
    expect(inner.nameRoles).toHaveBeenCalledTimes(2);
  });
});

describe('LlmRoleNamer: ответ свободной модели', () => {
  it('читает голый массив без обёртки roles', async () => {
    const namer = new LlmRoleNamer({
      apiKey: 'k',
      model: 'm',
      client: client(
        JSON.stringify([
          { title: 'Продакт-менеджер', reason: 'вёл продукты', evidenceRefs: ['memory:1'] },
        ]),
      ),
    });

    await expect(namer.nameRoles(facts, 'ru')).resolves.toMatchObject({ roles: [
      { title: 'Продакт-менеджер', reason: 'вёл продукты', evidenceRefs: ['memory:1'] },
    ] });
  });

  it('читает ответ, где модель назвала поля по-своему', async () => {
    // Живой ответ `nemotron-3-ultra:free` с прода 2026-09-03: массив
    // `{role, explanation, refs}`. Смысл тот же, буквы другие.
    const namer = new LlmRoleNamer({
      apiKey: 'k',
      model: 'm',
      client: client(
        JSON.stringify([
          {
            role: 'Product Manager (Fintech)',
            explanation: 'Девять лет вёл внутренние продукты',
            refs: ['memory:1'],
          },
        ]),
      ),
    });

    await expect(namer.nameRoles(facts, 'ru')).resolves.toMatchObject({ roles: [
      {
        title: 'Product Manager (Fintech)',
        reason: 'Девять лет вёл внутренние продукты',
        evidenceRefs: ['memory:1'],
      },
    ] });
  });

  it('не просит json_object у модели без структурированного вывода', async () => {
    const stub = client('{"roles":[]}');
    const namer = new LlmRoleNamer({ apiKey: 'k', model: 'm', client: stub, structuredOutput: false });

    await namer.nameRoles(facts, 'ru');

    // На проде `response_format: json_object` ломал вызов у
    // `nemotron-3-ultra:free`: ответ приходил без `choices`, и роль просто
    // не называлась (B180).
    expect(stub.chat.completions.create).toHaveBeenCalledWith(
      expect.not.objectContaining({ response_format: expect.anything() }),
    );
  });
});

describe('LlmRoleNamer и структурированный вывод OpenRouter', () => {
  it('требует маршрутизации к модели со схемой, когда схему просим', async () => {
    const stub = client('{"roles":[]}');
    const namer = new LlmRoleNamer({
      apiKey: 'k',
      model: 'openrouter/free',
      structuredOutput: true,
      requireParameters: true,
      client: stub,
    });

    await namer.nameRoles(facts, 'ru');

    const body = vi.mocked(stub.chat.completions.create).mock.calls[0]?.[0] as
      | Record<string, unknown>
      | undefined;
    expect(body?.response_format).toMatchObject({ type: 'json_schema' });
    expect(body?.provider).toEqual({ require_parameters: true });
  });
});

describe('QueuedRoleNamer', () => {
  const namer = (roles: NamedRole[]): RoleNamer => ({
    nameRoles: vi
      .fn()
      .mockResolvedValue(roles.length > 0 ? { roles, stage: 'test:stage' } : { roles: [] }),
  });

  it('отдаёт ответ первой ступени, которая назвала роли', async () => {
    const first = namer([]);
    const second = namer([{ title: 'COO', reason: 'вёл операции', evidenceRefs: ['memory:1'] }]);
    const third = namer([{ title: 'CTO', reason: 'вёл технологии', evidenceRefs: ['memory:2'] }]);

    const queued = new QueuedRoleNamer([first, second, third]);

    await expect(queued.nameRoles(facts, 'ru')).resolves.toMatchObject({ roles: [
      { title: 'COO', reason: 'вёл операции', evidenceRefs: ['memory:1'] },
    ] });
    // Молчание первой ступени — повод спросить следующую, а не отдать пусто.
    expect(first.nameRoles).toHaveBeenCalled();
    // Ступень за ответившей не тревожится.
    expect(third.nameRoles).not.toHaveBeenCalled();
  });

  it('пусто, когда промолчали все', async () => {
    const queued = new QueuedRoleNamer([namer([]), namer([])]);
    await expect(queued.nameRoles(facts, 'ru')).resolves.toMatchObject({ roles: [] });
  });
});

function namedRoleHygieneIsWired(namer: unknown): boolean {
  const inner = (namer as { inner?: unknown })?.inner;
  return inner instanceof HygienicRoleNamer;
}

describe('buildRoleNamer', () => {
  it('строит очередь и пропускает ступени с другим транспортом', () => {
    const built = buildRoleNamer({
      personalProvider: 'openrouter',
      model: 'nvidia/nemotron-3-ultra-550b-a55b:free',
      fallbacks: [
        { provider: 'openrouter', model: 'openrouter/free' },
        // Gemini говорит не на chat/completions — честнее пропустить ступень,
        // чем звать её транспортом, которого она не понимает.
        { provider: 'gemini', model: 'gemini-3.6-flash' },
        { provider: 'openai', model: 'gpt-5.6-luna' },
      ],
      providerCredentials: { openrouter: 'k', gemini: 'k', openai: 'k' },
    });

    expect(describeRoleNamerQueue(built)).toEqual([
      'openrouter:nvidia/nemotron-3-ultra-550b-a55b:free',
      'openrouter:openrouter/free',
      'openai:gpt-5.6-luna',
    ]);
    // Названия ролей уходят кандидату и переживают рестарт в хранилище — они
    // обязаны проходить чистку до записи в него (B210).
    expect(namedRoleHygieneIsWired(built)).toBe(true);
  });

  it('без ключей ступеней нет вовсе', () => {
    expect(buildRoleNamer({ personalProvider: 'openrouter', providerCredentials: {} })).toBeUndefined();
  });
});

describe('GeminiRoleNamer', () => {
  const answer = {
    candidates: [
      {
        content: {
          parts: [
            {
              text: JSON.stringify({
                roles: [
                  { title: 'CTO', reason: 'вёл технологии', evidenceRefs: ['memory:2'] },
                ],
              }),
            },
          ],
        },
      },
    ],
  };

  it('спрашивает generateContent через шлюз и читает названные роли', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const namer = new GeminiRoleNamer({
      apiKey: 'gemini-key',
      model: 'gemini-3.6-flash',
      baseUrl: 'https://gateway.test/google-ai-studio/v1beta',
      extraHeaders: { 'cf-aig-authorization': 'Bearer gate' },
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init: init as RequestInit });
        return new Response(JSON.stringify(answer), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    });

    await expect(namer.nameRoles(facts, 'ru')).resolves.toMatchObject({ roles: [
      { title: 'CTO', reason: 'вёл технологии', evidenceRefs: ['memory:2'] },
    ] });

    expect(calls[0]?.url).toBe(
      'https://gateway.test/google-ai-studio/v1beta/models/gemini-3.6-flash:generateContent',
    );
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers['x-goog-api-key']).toBe('gemini-key');
    expect(headers['cf-aig-authorization']).toBe('Bearer gate');
    const body = JSON.parse(String(calls[0]?.init.body));
    expect(body.generationConfig.responseMimeType).toBe('application/json');
    expect(body.generationConfig.responseJsonSchema).toBeDefined();
  });

  it('молчит вместо падения, когда шлюз отказал', async () => {
    const namer = new GeminiRoleNamer({
      apiKey: 'k',
      model: 'gemini-3.6-flash',
      baseUrl: 'https://gateway.test/v1beta',
      fetchImpl: async () => new Response('overloaded', { status: 503 }),
    });
    await expect(namer.nameRoles(facts, 'ru')).resolves.toMatchObject({ roles: [] });
  });
});

describe('buildRoleNamer с Gemini', () => {
  it('ставит Gemini головой очереди называния ролей', () => {
    const built = buildRoleNamer({
      personalProvider: 'openrouter',
      model: 'nvidia/nemotron-3-ultra-550b-a55b:free',
      fallbacks: [
        { provider: 'openrouter', model: 'openrouter/free' },
        { provider: 'gemini', model: 'gemini-3.6-flash' },
        { provider: 'openai', model: 'gpt-5.6-luna' },
      ],
      providerCredentials: { openrouter: 'k', gemini: 'k', openai: 'k' },
      cloudflareGateway: { accountId: 'acc', gatewayId: 'gate' },
    });

    // Решение владельца 2026-09-03: 14.7 с против 59 с у бесплатной головы.
    expect(describeRoleNamerQueue(built)[0]).toBe('gemini:gemini-3.6-flash');
  });

  it('без тоннеля ступень Gemini пропускается, а не зовётся напрямую', () => {
    const built = buildRoleNamer({
      personalProvider: 'openrouter',
      model: 'nvidia/nemotron-3-ultra-550b-a55b:free',
      fallbacks: [{ provider: 'gemini', model: 'gemini-3.6-flash' }],
      providerCredentials: { openrouter: 'k', gemini: 'k' },
    });

    expect(describeRoleNamerQueue(built)).toEqual([
      'openrouter:nvidia/nemotron-3-ultra-550b-a55b:free',
    ]);
  });
});

describe('язык названия у ступеней и кэша', () => {
  it('инструкция едет тем языком, который дал вызывающий', async () => {
    const stub = client('{"roles":[]}');
    const namer = new LlmRoleNamer({ apiKey: 'k', model: 'm', client: stub });

    await namer.nameRoles(facts, 'en');

    const body = vi.mocked(stub.chat.completions.create).mock.calls[0]?.[0] as
      | { messages: Array<{ content: string }> }
      | undefined;
    expect(body?.messages[0]?.content).toContain('английск');
  });

  it('кэш не выдаёт русский ответ за английский', async () => {
    const inner: RoleNamer = {
      nameRoles: vi.fn().mockResolvedValue({
        roles: [{ title: 'CTO', reason: 'вёл технологии', evidenceRefs: ['memory:2'] }],
        stage: 'test:stage',
      }),
    };
    const cached = new CachedRoleNamer(inner);

    await cached.nameRoles(facts, 'ru');
    await cached.nameRoles(facts, 'en');

    // Те же факты на другом языке — другой ответ, а не попадание в кэш.
    expect(inner.nameRoles).toHaveBeenCalledTimes(2);
  });
});

describe('провенанс ступени называния', () => {
  it('очередь называет ступень, которая ответила', async () => {
    const silent: RoleNamer = { nameRoles: vi.fn().mockResolvedValue({ roles: [] }) };
    const answered: RoleNamer = {
      nameRoles: vi.fn().mockResolvedValue({
        roles: [{ title: 'COO', reason: 'вёл операции', evidenceRefs: ['memory:1'] }],
        stage: 'openai:gpt-5.6-luna',
      }),
    };

    await expect(new QueuedRoleNamer([silent, answered]).nameRoles(facts, 'en')).resolves.toEqual({
      roles: [{ title: 'COO', reason: 'вёл операции', evidenceRefs: ['memory:1'] }],
      stage: 'openai:gpt-5.6-luna',
    });
  });

  it('ступень называет себя своим же именем из очереди', async () => {
    const namer = new LlmRoleNamer({
      apiKey: 'k',
      model: 'm',
      stage: 'openrouter:openrouter/free',
      client: client(
        JSON.stringify({ roles: [{ title: 'CTO', reason: 'вёл технологии', evidenceRefs: ['memory:2'] }] }),
      ),
    });

    await expect(namer.nameRoles(facts, 'en')).resolves.toMatchObject({
      stage: 'openrouter:openrouter/free',
    });
  });

  it('молчание ступени ступенью не называется', async () => {
    const namer = new LlmRoleNamer({ apiKey: 'k', model: 'm', stage: 'openrouter:x', client: client(null) });
    const outcome = await namer.nameRoles(facts, 'en');
    expect(outcome.roles).toEqual([]);
    expect(outcome.stage).toBeUndefined();
  });
});

/**
 * INC-035: голова очереди молчала на проде, и отличить исчерпанную квоту от
 * отказа шлюза было нечем — ступень глотала и код ответа, и причину (B186).
 */
describe('причина молчания ступени (B186)', () => {
  it('Gemini называет код ответа и текст отказа шлюза', async () => {
    const namer = new GeminiRoleNamer({
      apiKey: 'gemini-key',
      model: 'gemini-3.6-flash',
      stage: 'gemini:gemini-3.6-flash',
      baseUrl: 'https://gateway.test/v1beta',
      fetchImpl: async () => new Response('{"error":{"status":"RESOURCE_EXHAUSTED"}}', { status: 429 }),
    });

    const outcome = await namer.nameRoles(facts, 'ru');

    expect(outcome.roles).toEqual([]);
    expect(outcome.failures).toEqual([
      {
        stage: 'gemini:gemini-3.6-flash',
        kind: 'http_error',
        status: 429,
        detail: '{"error":{"status":"RESOURCE_EXHAUSTED"}}',
      },
    ]);
  });

  it('Gemini отличает таймаут от отказа шлюза', async () => {
    const namer = new GeminiRoleNamer({
      apiKey: 'k',
      model: 'gemini-3.6-flash',
      stage: 'gemini:gemini-3.6-flash',
      baseUrl: 'https://gateway.test/v1beta',
      fetchImpl: async () => {
        throw new DOMException('The operation was aborted', 'TimeoutError');
      },
    });

    expect((await namer.nameRoles(facts, 'ru')).failures).toEqual([
      { stage: 'gemini:gemini-3.6-flash', kind: 'timeout' },
    ]);
  });

  it('Gemini отличает негодный ответ от отказа транспорта', async () => {
    const namer = new GeminiRoleNamer({
      apiKey: 'k',
      model: 'gemini-3.6-flash',
      stage: 'gemini:gemini-3.6-flash',
      baseUrl: 'https://gateway.test/v1beta',
      fetchImpl: async () =>
        new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'не json' }] } }] }), {
          status: 200,
        }),
    });

    expect((await namer.nameRoles(facts, 'ru')).failures).toEqual([
      { stage: 'gemini:gemini-3.6-flash', kind: 'unusable_response' },
    ]);
  });

  it('ступень chat/completions называет код отказа провайдера', async () => {
    const failing: ChatCompletionClient = {
      chat: {
        completions: {
          create: vi.fn().mockRejectedValue(
            Object.assign(new Error('429 Too Many Requests'), { status: 429 }),
          ),
        },
      },
    };
    const namer = new LlmRoleNamer({
      apiKey: 'k',
      model: 'm',
      stage: 'openrouter:openrouter/free',
      client: failing,
    });

    expect((await namer.nameRoles(facts, 'ru')).failures).toEqual([
      {
        stage: 'openrouter:openrouter/free',
        kind: 'http_error',
        status: 429,
        detail: '429 Too Many Requests',
      },
    ]);
  });

  it('ответ не по схеме — негодный ответ, а не отказ транспорта', async () => {
    const namer = new LlmRoleNamer({
      apiKey: 'k',
      model: 'm',
      stage: 'openai:gpt-5.6-luna',
      client: client('не json'),
    });

    expect((await namer.nameRoles(facts, 'ru')).failures).toEqual([
      { stage: 'openai:gpt-5.6-luna', kind: 'unusable_response' },
    ]);
  });

  it('причина не выносит наружу ключ провайдера', async () => {
    const namer = new GeminiRoleNamer({
      apiKey: 'super-secret-key',
      model: 'gemini-3.6-flash',
      baseUrl: 'https://gateway.test/v1beta',
      fetchImpl: async () => new Response('bad key super-secret-key rejected', { status: 403 }),
    });

    const detail = (await namer.nameRoles(facts, 'ru')).failures?.[0]?.detail ?? '';
    expect(detail).not.toContain('super-secret-key');
  });

  it('очередь копит причины всех промолчавших ступеней', async () => {
    const silent: RoleNamer = {
      nameRoles: vi.fn().mockResolvedValue({
        roles: [],
        failures: [{ stage: 'gemini:gemini-3.6-flash', kind: 'timeout' }],
      }),
    };
    const answered: RoleNamer = {
      nameRoles: vi.fn().mockResolvedValue({
        roles: [{ title: 'COO', reason: 'вёл операции', evidenceRefs: ['memory:1'] }],
        stage: 'openai:gpt-5.6-luna',
      }),
    };

    await expect(new QueuedRoleNamer([silent, answered]).nameRoles(facts, 'en')).resolves.toEqual({
      roles: [{ title: 'COO', reason: 'вёл операции', evidenceRefs: ['memory:1'] }],
      stage: 'openai:gpt-5.6-luna',
      failures: [{ stage: 'gemini:gemini-3.6-flash', kind: 'timeout' }],
    });
  });

  it('кэш не повторяет в логе отказ четвертьчасовой давности', async () => {
    const inner: RoleNamer = {
      nameRoles: vi.fn().mockResolvedValue({
        roles: [{ title: 'CTO', reason: 'вёл технологии', evidenceRefs: ['memory:2'] }],
        stage: 'openai:gpt-5.6-luna',
        failures: [{ stage: 'gemini:gemini-3.6-flash', kind: 'timeout' }],
      }),
    };
    const cached = new CachedRoleNamer(inner);

    expect((await cached.nameRoles(facts, 'ru')).failures).toHaveLength(1);
    // Второй вход кандидата — то же попадание в кэш, но отказ уже записан.
    expect((await cached.nameRoles(facts, 'ru')).failures).toBeUndefined();
  });
});
