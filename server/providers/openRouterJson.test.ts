import { describe, expect, it, vi } from 'vitest';
import { requestChatJson } from './openRouterJson';

function capture() {
  return vi.fn(
    async (_url: string, _init?: RequestInit) =>
      new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] })),
  );
}
const request = { system: 's', user: 'u', maxTokens: 10, timeoutMs: 1_000 };

describe('поле reasoning на ступенях OpenRouter (04.11)', () => {
  it.each([
    ['z-ai/glm-5.3-flash', { effort: 'low' }],
    ['deepseek/deepseek-v4-flash', { enabled: false }],
  ])('%s', async (model, expected) => {
    const fetchImpl = capture();
    await requestChatJson(
      { provider: 'openrouter', apiKey: 'k', model },
      request,
      fetchImpl as unknown as typeof fetch,
    );
    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body)) as { reasoning: unknown };
    expect(body.reasoning).toEqual(expected);
  });
});
