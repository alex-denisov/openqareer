import { describe, expect, it, vi } from 'vitest';
import type { NamedRole } from '../../shared/roleProposals';
import {
  buildRoleNamer,
  CachedRoleNamer,
  describeRoleNamerQueue,
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

    await expect(namer.nameRoles(facts)).resolves.toEqual([
      { title: 'Продакт-менеджер', reason: 'вёл продукты', evidenceRefs: ['memory:1'] },
    ]);
  });

  it('возвращает пусто, когда модель ответила не по схеме', async () => {
    const namer = new LlmRoleNamer({ apiKey: 'k', model: 'm', client: client('не json') });
    await expect(namer.nameRoles(facts)).resolves.toEqual([]);
  });

  it('не спрашивает модель, когда фактов нет', async () => {
    const stub = client('{"roles":[]}');
    const namer = new LlmRoleNamer({ apiKey: 'k', model: 'm', client: stub });

    await expect(namer.nameRoles([])).resolves.toEqual([]);
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

    await expect(namer.nameRoles(facts)).resolves.toEqual([]);
  });
});

describe('CachedRoleNamer', () => {
  const roles = [{ title: 'Продакт-менеджер', reason: 'вёл продукты', evidenceRefs: ['memory:1'] }];

  it('не спрашивает модель второй раз, пока факты те же', async () => {
    const inner = { nameRoles: vi.fn().mockResolvedValue(roles) };
    const namer = new CachedRoleNamer(inner);

    await namer.nameRoles(facts);
    await expect(namer.nameRoles(facts)).resolves.toEqual(roles);
    expect(inner.nameRoles).toHaveBeenCalledTimes(1);
  });

  it('спрашивает заново, когда факты изменились', async () => {
    const inner = { nameRoles: vi.fn().mockResolvedValue(roles) };
    const namer = new CachedRoleNamer(inner);

    await namer.nameRoles(facts);
    await namer.nameRoles([...facts, { ref: 'memory:3', statement: 'Запускал маркетплейс' }]);
    expect(inner.nameRoles).toHaveBeenCalledTimes(2);
  });

  it('не запоминает отказ: пустой ответ спрашивается заново', async () => {
    const inner = { nameRoles: vi.fn().mockResolvedValue([]) };
    const namer = new CachedRoleNamer(inner);

    await namer.nameRoles(facts);
    await namer.nameRoles(facts);
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

    await expect(namer.nameRoles(facts)).resolves.toEqual([
      { title: 'Продакт-менеджер', reason: 'вёл продукты', evidenceRefs: ['memory:1'] },
    ]);
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

    await expect(namer.nameRoles(facts)).resolves.toEqual([
      {
        title: 'Product Manager (Fintech)',
        reason: 'Девять лет вёл внутренние продукты',
        evidenceRefs: ['memory:1'],
      },
    ]);
  });

  it('не просит json_object у модели без структурированного вывода', async () => {
    const stub = client('{"roles":[]}');
    const namer = new LlmRoleNamer({ apiKey: 'k', model: 'm', client: stub, structuredOutput: false });

    await namer.nameRoles(facts);

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

    await namer.nameRoles(facts);

    const body = vi.mocked(stub.chat.completions.create).mock.calls[0]?.[0] as
      | Record<string, unknown>
      | undefined;
    expect(body?.response_format).toMatchObject({ type: 'json_schema' });
    expect(body?.provider).toEqual({ require_parameters: true });
  });
});

describe('QueuedRoleNamer', () => {
  const namer = (roles: NamedRole[]): RoleNamer => ({
    nameRoles: vi.fn().mockResolvedValue(roles),
  });

  it('отдаёт ответ первой ступени, которая назвала роли', async () => {
    const first = namer([]);
    const second = namer([{ title: 'COO', reason: 'вёл операции', evidenceRefs: ['memory:1'] }]);
    const third = namer([{ title: 'CTO', reason: 'вёл технологии', evidenceRefs: ['memory:2'] }]);

    const queued = new QueuedRoleNamer([first, second, third]);

    await expect(queued.nameRoles(facts)).resolves.toEqual([
      { title: 'COO', reason: 'вёл операции', evidenceRefs: ['memory:1'] },
    ]);
    // Молчание первой ступени — повод спросить следующую, а не отдать пусто.
    expect(first.nameRoles).toHaveBeenCalled();
    // Ступень за ответившей не тревожится.
    expect(third.nameRoles).not.toHaveBeenCalled();
  });

  it('пусто, когда промолчали все', async () => {
    const queued = new QueuedRoleNamer([namer([]), namer([])]);
    await expect(queued.nameRoles(facts)).resolves.toEqual([]);
  });
});

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
  });

  it('без ключей ступеней нет вовсе', () => {
    expect(buildRoleNamer({ personalProvider: 'openrouter', providerCredentials: {} })).toBeUndefined();
  });
});
