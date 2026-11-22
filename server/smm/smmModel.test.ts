import { describe, expect, it, vi } from 'vitest';
import { createSmmModel } from './smmModel';

const reply = (content: string) =>
  new Response(
    JSON.stringify({
      id: 'x',
      object: 'chat.completion',
      created: 1,
      model: 'm',
      choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }],
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );

describe('createSmmModel budget', () => {
  it('sends the call budget and reasoning effort to OpenRouter', async () => {
    const fetchImpl = vi.fn(async () => reply('ответ'));
    const model = createSmmModel({
      openRouterKey: 'test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      log: () => {},
    });
    await model.complete([{ role: 'user', content: 'x' }], undefined, {
      outputTokens: 16_000,
      reasoningEffort: 'low',
    });
    const body = JSON.parse(
      String((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body),
    );
    expect(body.max_tokens).toBe(16_000);
    expect(body.reasoning).toEqual({ effort: 'low' });
  });

  it('keeps the default cap and no reasoning field without a budget', async () => {
    const fetchImpl = vi.fn(async () => reply('ответ'));
    const model = createSmmModel({
      openRouterKey: 'test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      log: () => {},
    });
    await model.complete([{ role: 'user', content: 'x' }]);
    const body = JSON.parse(
      String((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body),
    );
    expect(body.max_tokens).toBe(6_000);
    expect(body.reasoning).toBeUndefined();
  });
});
