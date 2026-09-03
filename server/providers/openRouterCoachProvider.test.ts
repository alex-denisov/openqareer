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
      reasoning_effort: 'high',
    });
    // Запасной маршрут — это ступень очереди, а не скрытый второй адресат
    // внутри одной ступени: список `models` заставлял OpenRouter молча
    // отвечать другой моделью, и замер B185 принял это за поведение суффикса
    // `:free`. Провенанс обязан называть ту модель, которую попросили.
    expect(calls[0].body).not.toHaveProperty('models');
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
    expect(calls[0]).toMatchObject({ model: 'pinned/provider-model' });
    expect(calls[0]).not.toHaveProperty('models');
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

describe('OpenRouterCoachProvider: место под ответ', () => {
  it('даёт стратегу больше места, чем эксперту, и не стоит на прежней тройке', async () => {
    const calls: Record<string, unknown>[] = [];
    const provider = routerWith(async (body) => {
      calls.push(body);
      return routerResponse(JSON.stringify(validOutput));
    }, 'pinned/provider-model');

    await provider.createTurn(
      { ...syntheticInput, activeRole: 'career_expert' },
      'key-expert',
    );
    await provider.createTurn(
      { ...syntheticInput, activeRole: 'career_strategist' },
      'key-strategist',
    );

    const expert = calls[0].max_completion_tokens as number;
    const strategist = calls[1].max_completion_tokens as number;
    // Потолок в 2 400 обрезал ответ на реальном ходе: замер B185 дал
    // `provider_output_invalid` там, где модель просто не дописала JSON.
    expect(expert).toBeGreaterThan(2_400);
    expect(strategist).toBeGreaterThan(expert);
  });
});

describe('OpenRouter structured output', () => {
  const respond = (calls: Array<Record<string, unknown>>) => ({
    chat: {
      completions: {
        create: async (body: Record<string, unknown>) => {
          calls.push(body);
          return {
            id: 'response-structured',
            model: 'z-ai/glm-5.2:free',
            choices: [{ message: { content: JSON.stringify(validOutput) } }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          };
        },
      },
    },
  });

  it('просит схему и требует маршрутизации только к моделям, которые её держат', async () => {
    const calls: Array<Record<string, unknown>> = [];
    const provider = new OpenRouterCoachProvider({
      apiKey: 'k',
      model: 'openrouter/free',
      structuredOutput: true,
      client: respond(calls) as unknown as OpenAI,
    });

    await provider.createTurn(syntheticInput, 'idempotency-structured');

    expect(calls[0]?.response_format).toMatchObject({
      type: 'json_schema',
      json_schema: { name: 'career_coach_turn', strict: true },
    });
    expect(calls[0]?.provider).toEqual({ require_parameters: true });
  });

  it('не требует маршрутизации у поимённо названной модели', async () => {
    const calls: Array<Record<string, unknown>> = [];
    const provider = new OpenRouterCoachProvider({
      apiKey: 'k',
      model: 'nvidia/nemotron-3-ultra-550b-a55b:free',
      structuredOutput: true,
      client: respond(calls) as unknown as OpenAI,
    });

    await provider.createTurn(syntheticInput, 'idempotency-named');

    expect(calls[0]?.response_format).toMatchObject({ type: 'json_schema' });
    // Живая проверка 2026-09-03: `require_parameters` у названной модели даёт
    // `404 No endpoints found` за полсекунды — выбирать маршрутизации не из чего.
    expect(calls[0]?.provider).toBeUndefined();
  });

  it('не навязывает схему модели, которая её не держит', async () => {
    const calls: Array<Record<string, unknown>> = [];
    const provider = new OpenRouterCoachProvider({
      apiKey: 'k',
      model: 'openrouter/free',
      structuredOutput: false,
      client: respond(calls) as unknown as OpenAI,
    });

    await provider.createTurn(syntheticInput, 'idempotency-plain');

    expect(calls[0]?.response_format).toBeUndefined();
    expect(calls[0]?.provider).toBeUndefined();
  });
});
