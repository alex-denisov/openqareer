import type OpenAI from 'openai';
import {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  RateLimitError,
} from 'openai/error';
import { describe, expect, it } from 'vitest';
import type { CoachTurnInput } from '../domain/coach';
import { OpenRouterCoachProvider } from './openRouterCoachProvider';

const syntheticInput: CoachTurnInput = {
  candidateReference: 'candidate-test-001',
  dataClass: 'synthetic',
  locale: 'ru-RU',
  phase: 'discovery',
  messages: [
    {
      id: 'message-1',
      role: 'user',
      content: 'Тестовый кандидат запускал продукт.',
    },
  ],
};

const validOutput = {
  message: 'Уточним масштаб запуска.',
  phase: 'evidence',
  memoryCandidates: [],
  nextQuestion: 'Сколько человек было в команде?',
  completeness: {
    known: ['Есть опыт запуска'],
    unknown: ['Масштаб'],
  },
  safety: {
    needsHuman: false,
    reason: null,
  },
  careerTrack: null,
  actionProposals: [],
};

describe('OpenRouter synthetic coach provider', () => {
  it('uses Ultra with a same-family ordered fallback and server validation', async () => {
    const calls: Array<{ body: Record<string, unknown>; options: unknown }> = [];
    const client = {
      chat: {
        completions: {
          create: async (
            body: Record<string, unknown>,
            options: unknown,
          ) => {
            calls.push({ body, options });
            return {
              id: 'response-1',
              model: 'nvidia/nemotron-3-ultra-550b-a55b',
              choices: [
                { message: { content: JSON.stringify(validOutput) } },
              ],
              usage: {
                prompt_tokens: 50,
                completion_tokens: 40,
                total_tokens: 90,
              },
            };
          },
        },
      },
    } as unknown as OpenAI;
    const provider = new OpenRouterCoachProvider({
      apiKey: 'not-used-by-test',
      client,
    });

    const output = await provider.createTurn(
      syntheticInput,
      'idempotency-key',
    );

    expect(output.result).toEqual(validOutput);
    expect(output.provider).toBe('openrouter');
    expect(calls[0].body).toMatchObject({
      model: 'nvidia/nemotron-3-ultra-550b-a55b:free',
      models: [
        'nvidia/nemotron-3-ultra-550b-a55b:free',
        'nvidia/nemotron-3-super-120b-a12b:free',
      ],
      reasoning_effort: 'high',
    });
    expect(calls[0].body).not.toHaveProperty('response_format');
    expect(calls[0].options).toEqual({
      idempotencyKey: 'idempotency-key',
    });
  });

  it('refuses to send personal data to the free route', async () => {
    const provider = new OpenRouterCoachProvider({
      apiKey: 'not-used-by-test',
      client: {} as OpenAI,
    });

    await expect(
      provider.createTurn(
        { ...syntheticInput, dataClass: 'personal' },
        'idempotency-key',
      ),
    ).rejects.toMatchObject({
      code: 'provider_unavailable',
      statusCode: 503,
      retryable: false,
    });
  });

  it.each([
    ['a fenced JSON block', `\`\`\`json\n${JSON.stringify(validOutput)}\n\`\`\``],
    ['surrounding prose', `Result follows: ${JSON.stringify(validOutput)} done`],
  ])('extracts %s while preserving a pinned custom model', async (_case, content) => {
    const calls: Record<string, unknown>[] = [];
    const provider = routerWith(async (body) => {
      calls.push(body);
      return routerResponse(content);
    }, 'pinned/provider-model');

    const result = await provider.createTurn(syntheticInput, 'idempotency-key');

    expect(result.result).toEqual(validOutput);
    expect(calls[0]).toMatchObject({
      model: 'pinned/provider-model',
      models: ['pinned/provider-model'],
    });
  });

  it.each([
    ['missing content', undefined],
    ['malformed JSON', 'not-json'],
    ['schema mismatch', '{}'],
  ])('fails closed on %s', async (_case, content) => {
    const provider = routerWith(async () => routerResponse(content));

    await expect(
      provider.createTurn(syntheticInput, 'idempotency-key'),
    ).rejects.toMatchObject({ code: 'provider_output_invalid', statusCode: 502 });
  });

  it.each([
    [
      'rate limit class',
      new RateLimitError(429, { message: 'limited' }, 'limited', new Headers()),
      'provider_rate_limited',
      429,
      true,
    ],
    [
      'timeout',
      new APIConnectionTimeoutError(),
      'provider_timeout',
      504,
      true,
    ],
    [
      'connection error',
      new APIConnectionError({ message: 'offline' }),
      'provider_unavailable',
      503,
      true,
    ],
    [
      'HTTP 429',
      new APIError(429, { message: 'limited' }, 'limited', new Headers()),
      'provider_rate_limited',
      429,
      true,
    ],
    [
      'HTTP 402',
      new APIError(402, { message: 'credits' }, 'credits', new Headers()),
      'provider_budget_exhausted',
      502,
      false,
    ],
    [
      'HTTP 500',
      new APIError(500, { message: 'failed' }, 'failed', new Headers()),
      'provider_unavailable',
      503,
      true,
    ],
    [
      'unknown client error',
      new APIError(400, { message: 'bad' }, 'bad', new Headers()),
      'provider_unavailable',
      503,
      true,
    ],
  ] as const)(
    'maps %s without leaking provider payloads',
    async (_case, error, code, statusCode, retryable) => {
      const provider = routerWith(async () => {
        throw error;
      });

      await expect(
        provider.createTurn(syntheticInput, 'idempotency-key'),
      ).rejects.toMatchObject({ code, statusCode, retryable });
    },
  );
});

function routerWith(
  create: (body: Record<string, unknown>) => Promise<unknown>,
  model?: string,
) {
  const client = {
    chat: { completions: { create } },
  } as unknown as OpenAI;
  return new OpenRouterCoachProvider({
    apiKey: 'not-used-by-test',
    model,
    client,
  });
}

function routerResponse(content: string | undefined) {
  return {
    id: 'router-response',
    model: 'pinned/provider-model',
    choices: [{ message: { content } }],
  };
}
