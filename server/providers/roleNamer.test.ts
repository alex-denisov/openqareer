import { describe, expect, it, vi } from 'vitest';
import { CachedRoleNamer, LlmRoleNamer, type ChatCompletionClient } from './roleNamer';

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
