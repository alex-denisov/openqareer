import { describe, expect, it } from 'vitest';
import type { CoachTurnInput } from '../domain/coach';
import {
  NativeCoachProvider,
  type NativeProviderId,
} from './nativeCoachProvider';

const input: CoachTurnInput = {
  candidateReference: 'candidate-test-001',
  dataClass: 'synthetic',
  locale: 'ru-RU',
  phase: 'discovery',
  messages: [{ id: 'message-1', role: 'user', content: 'Проверим опыт.' }],
};

const result = {
  message: 'Уточним результат.',
  phase: 'evidence',
  memoryCandidates: [],
  nextQuestion: 'Что изменилось?',
  completeness: { known: ['Есть опыт'], unknown: ['Результат'] },
  safety: { needsHuman: false, reason: null },
};

function responseFor(provider: NativeProviderId): unknown {
  const text = JSON.stringify(result);
  if (provider === 'anthropic') {
    return {
      id: 'anthropic-response',
      model: 'claude-fable-5',
      content: [{ type: 'text', text }],
      usage: { input_tokens: 11, output_tokens: 22 },
    };
  }
  if (provider === 'gemini') {
    return {
      responseId: 'gemini-response',
      modelVersion: 'gemini-3.5-flash',
      candidates: [{ content: { parts: [{ text }] } }],
      usageMetadata: {
        promptTokenCount: 11,
        candidatesTokenCount: 22,
        totalTokenCount: 33,
      },
    };
  }
  if (provider === 'cohere') {
    return {
      id: 'cohere-response',
      message: { content: [{ type: 'text', text }] },
      usage: { tokens: { input_tokens: 11, output_tokens: 22 } },
    };
  }
  return {
    result: {
      modelVersion: 'yandexgpt-version',
      alternatives: [{ message: { text } }],
      usage: {
        inputTextTokens: '11',
        completionTokens: '22',
        totalTokens: '33',
      },
    },
  };
}

describe('native provider connectors', () => {
  for (const provider of [
    'anthropic',
    'gemini',
    'cohere',
    'yandex',
  ] as const satisfies readonly NativeProviderId[]) {
    it(`normalizes ${provider} output without exposing its key`, async () => {
      const requests: Array<{ url: string; init: RequestInit }> = [];
      const fetchImpl: typeof fetch = async (url, init) => {
        requests.push({ url: String(url), init: init ?? {} });
        return new Response(JSON.stringify(responseFor(provider)), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      };
      const connector = new NativeCoachProvider({
        provider,
        apiKey: 'secret-that-must-not-be-returned',
        baseUrl: 'https://provider.invalid/v1',
        model:
          provider === 'yandex' ? 'yandexgpt/latest' : `${provider}-model`,
        folderId: provider === 'yandex' ? 'folder-test' : undefined,
        fetchImpl,
      });

      const output = await connector.createTurn(input, 'idempotency-key');

      expect(output).toMatchObject({
        provider,
        result,
        usage: { inputTokens: 11, outputTokens: 22, totalTokens: 33 },
      });
      expect(JSON.stringify(output)).not.toContain(
        'secret-that-must-not-be-returned',
      );
      expect(requests).toHaveLength(1);
      expect(requests[0].init.method).toBe('POST');
    });
  }

  for (const provider of [
    'anthropic',
    'gemini',
    'cohere',
    'yandex',
  ] as const satisfies readonly NativeProviderId[]) {
    it(`fails closed when ${provider} omits its structured payload`, async () => {
      const connector = nativeWith(provider, async () =>
        new Response('{}', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      await expect(
        connector.createTurn(input, 'idempotency-key'),
      ).rejects.toMatchObject({
        code: 'provider_output_invalid',
        statusCode: 502,
      });
    });
  }

  it.each([
    [429, 'provider_rate_limited', 429, true],
    [500, 'provider_unavailable', 503, false],
    [408, 'provider_unavailable', 502, true],
    [400, 'provider_unavailable', 502, false],
  ] as const)(
    'maps HTTP %s to a typed provider error',
    async (status, code, statusCode, retryable) => {
      const connector = nativeWith('anthropic', async () =>
        new Response('upstream payload must not escape', { status }),
      );

      await expect(
        connector.createTurn(input, 'idempotency-key'),
      ).rejects.toMatchObject({ code, statusCode, retryable });
    },
  );

  it('requires a Yandex folder before making a request', async () => {
    const connector = new NativeCoachProvider({
      provider: 'yandex',
      apiKey: 'not-used-by-test',
      baseUrl: 'https://provider.invalid/v1/',
      model: 'yandexgpt/latest',
      fetchImpl: async () => {
        throw new Error('must not be called');
      },
    });

    await expect(
      connector.createTurn(input, 'idempotency-key'),
    ).rejects.toMatchObject({
      code: 'provider_unavailable',
      retryable: false,
    });
  });

  it.each([
    [new DOMException('timed out', 'TimeoutError'), 'provider_timeout', 504],
    [new Error('offline'), 'provider_unavailable', 503],
  ])('maps a transport failure without leaking it', async (error, code, statusCode) => {
    const connector = nativeWith('anthropic', async () => {
      throw error;
    });

    await expect(
      connector.createTurn(input, 'idempotency-key'),
    ).rejects.toMatchObject({ code, statusCode, retryable: true });
  });

  it('normalizes invalid and missing numeric Yandex usage to zero', async () => {
    const connector = nativeWith('yandex', async () =>
      new Response(
        JSON.stringify({
          result: {
            alternatives: [
              { message: { text: JSON.stringify(result) } },
            ],
            usage: {
              inputTextTokens: 'not-a-number',
              completionTokens: undefined,
              totalTokens: '33',
            },
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const output = await connector.createTurn(input, 'idempotency-key');

    expect(output.usage).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 33,
    });
  });
});

function nativeWith(provider: NativeProviderId, fetchImpl: typeof fetch) {
  return new NativeCoachProvider({
    provider,
    apiKey: 'not-used-by-test',
    baseUrl: 'https://provider.invalid/v1/',
    model: provider === 'yandex' ? 'yandexgpt/latest' : `${provider}-model`,
    folderId: provider === 'yandex' ? 'folder-test' : undefined,
    fetchImpl,
  });
}
