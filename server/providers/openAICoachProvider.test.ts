import type OpenAI from 'openai';
import {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  RateLimitError,
} from 'openai/error';
import { describe, expect, it } from 'vitest';
import type { CoachTurnInput } from '../domain/coach';
import { CoachProviderError } from './coachProvider';
import { OpenAICoachProvider,
  outputBudgetForRole,
} from './openAICoachProvider';

const input: CoachTurnInput = {
  candidateReference: 'candidate-test-001',
  dataClass: 'personal',
  locale: 'ru-RU',
  phase: 'discovery',
  messages: [
    {
      id: 'message-1',
      role: 'user',
      content: 'Я запускал продукт, но не уверен, как назвать роль.',
    },
  ],
};

const validOutput = {
  message: 'Сначала уточним масштаб запуска.',
  phase: 'evidence',
  memoryCandidates: [
    {
      kind: 'fact',
      domain: 'responsibility',
      statement: 'Кандидат сообщил об опыте запуска продукта.',
      confidence: 'candidate-reported',
      sourceMessageIds: ['message-1'],
      sensitive: false,
    },
  ],
  nextQuestion: 'Какой командой и бюджетом вы управляли?',
  completeness: {
    known: ['Есть опыт запуска продукта'],
    unknown: ['Масштаб запуска'],
  },
  safety: {
    needsHuman: false,
    reason: null,
  },
  careerTrack: null,
  actionProposals: [],
};

describe('OpenAI career coach provider', () => {
  it('uses stateless structured output and a hashed safety identifier', async () => {
    const calls: Array<{ body: Record<string, unknown>; options: unknown }> = [];
    const client = {
      responses: {
        create: async (
          body: Record<string, unknown>,
          options: unknown,
        ) => {
          calls.push({ body, options });
          return {
            id: 'response-1',
            model: 'gpt-5.6-sol-2026-07-09',
            output_text: JSON.stringify(validOutput),
            usage: {
              input_tokens: 120,
              output_tokens: 80,
              total_tokens: 200,
            },
          };
        },
      },
    } as unknown as OpenAI;
    const provider = new OpenAICoachProvider({
      apiKey: 'not-used-by-test',
      model: 'gpt-5.6-sol',
      client,
    });

    const output = await provider.createTurn(
      input,
      '95fb73e7-f531-4a79-a494-52217a2a54cd',
    );

    expect(output.result).toEqual(validOutput);
    expect(output.usage.totalTokens).toBe(200);
    expect(calls[0].body).toMatchObject({
      model: 'gpt-5.6-sol',
      store: false,
      max_output_tokens: 9_200,
      reasoning: {
        // Владелец выбрал максимальное усилие рассуждения (B183).
        effort: 'high',
        context: 'all_turns',
      },
    });
    expect(String(calls[0].body.safety_identifier)).toMatch(/^[a-f0-9]{64}$/);
    expect(String(calls[0].body.safety_identifier)).not.toContain(
      input.candidateReference,
    );
    expect(calls[0].options).toEqual({
      idempotencyKey: '95fb73e7-f531-4a79-a494-52217a2a54cd',
    });
  });

  it('reserves a larger output budget for the strategist role', async () => {
    const calls: Array<Record<string, unknown>> = [];
    const client = {
      responses: {
        create: async (body: Record<string, unknown>) => {
          calls.push(body);
          return {
            id: 'response-strategist',
            model: 'gpt-5.6-sol',
            status: 'completed',
            output: [],
            output_text: JSON.stringify(validOutput),
          };
        },
      },
    } as unknown as OpenAI;
    const provider = new OpenAICoachProvider({
      apiKey: 'not-used-by-test',
      model: 'gpt-5.6-sol',
      client,
    });

    await provider.createTurn(
      { ...input, activeRole: 'career_strategist' },
      '95fb73e7-f531-4a79-a494-52217a2a54cd',
    );

    expect(calls[0]).toMatchObject({ max_output_tokens: 12_000 });
  });

  it('classifies a token-limited response without parsing partial JSON', async () => {
    const client = {
      responses: {
        create: async () => ({
          id: 'response-incomplete',
          model: 'gpt-5.6-sol',
          status: 'incomplete',
          incomplete_details: { reason: 'max_output_tokens' },
          output: [],
          output_text: '{"message":"partial',
        }),
      },
    } as unknown as OpenAI;
    const provider = new OpenAICoachProvider({
      apiKey: 'not-used-by-test',
      model: 'gpt-5.6-sol',
      client,
    });

    await expect(
      provider.createTurn(
        { ...input, activeRole: 'career_strategist' },
        '95fb73e7-f531-4a79-a494-52217a2a54cd',
      ),
    ).rejects.toMatchObject({
      code: 'provider_output_invalid',
      diagnostic: 'response_incomplete_max_output_tokens',
      role: 'career_strategist',
    });
  });

  it('classifies a structured-output refusal without exposing its text', async () => {
    const client = {
      responses: {
        create: async () => ({
          id: 'response-refusal',
          model: 'gpt-5.6-sol',
          status: 'completed',
          output_text: '',
          output: [
            {
              type: 'message',
              content: [{ type: 'refusal', refusal: 'sensitive provider text' }],
            },
          ],
        }),
      },
    } as unknown as OpenAI;
    const provider = new OpenAICoachProvider({
      apiKey: 'not-used-by-test',
      model: 'gpt-5.6-sol',
      client,
    });

    await expect(
      provider.createTurn(
        { ...input, activeRole: 'career_expert' },
        '95fb73e7-f531-4a79-a494-52217a2a54cd',
      ),
    ).rejects.toMatchObject({
      code: 'provider_output_invalid',
      diagnostic: 'response_refusal',
      role: 'career_expert',
      message: 'provider_output_invalid',
    });
  });

  it('rejects malformed model output without exposing it', async () => {
    const client = {
      responses: {
        create: async () => ({
          id: 'response-2',
          model: 'gpt-5.6-sol',
          output_text: '{"message":"missing fields"}',
        }),
      },
    } as unknown as OpenAI;
    const provider = new OpenAICoachProvider({
      apiKey: 'not-used-by-test',
      model: 'gpt-5.6-sol',
      client,
    });

    await expect(
      provider.createTurn(
        input,
        '95fb73e7-f531-4a79-a494-52217a2a54cd',
      ),
    ).rejects.toMatchObject({
      code: 'provider_output_invalid',
      statusCode: 502,
    });
  });

  it('maps provider throttling to a retryable domain error', async () => {
    const client = {
      responses: {
        create: async () => {
          throw new RateLimitError(
            429,
            { error: { message: 'limited' } },
            'limited',
            new Headers(),
          );
        },
      },
    } as unknown as OpenAI;
    const provider = new OpenAICoachProvider({
      apiKey: 'not-used-by-test',
      model: 'gpt-5.6-sol',
      client,
    });

    await expect(
      provider.createTurn(
        input,
        '95fb73e7-f531-4a79-a494-52217a2a54cd',
      ),
    ).rejects.toEqual(
      expect.objectContaining<Partial<CoachProviderError>>({
        code: 'provider_rate_limited',
        statusCode: 429,
        retryable: true,
      }),
    );
  });

  it.each([
    [
      'another incomplete reason',
      { status: 'incomplete', incomplete_details: { reason: 'content_filter' }, output: [], output_text: '' },
      'response_incomplete_other',
    ],
    ['missing text', { status: 'completed', output: [], output_text: '' }, 'response_text_missing'],
    ['malformed JSON', { status: 'completed', output: [], output_text: '{not-json' }, 'response_json_invalid'],
  ] as const)('classifies %s precisely', async (_case, response, diagnostic) => {
    const provider = providerWith(async () => ({
      id: 'response-invalid',
      model: 'gpt-5.6-sol',
      ...response,
    }));

    await expect(
      provider.createTurn(input, 'idempotency-key'),
    ).rejects.toMatchObject({ code: 'provider_output_invalid', diagnostic });
  });

  it.each([
    [
      'credit exhaustion',
      new RateLimitError(
        429,
        { message: 'credits', code: 'credit_balance_exhausted' },
        'credits',
        new Headers(),
      ),
      'provider_budget_exhausted',
      503,
      false,
    ],
    ['timeout', new APIConnectionTimeoutError(), 'provider_timeout', 504, true],
    [
      'connection error',
      new APIConnectionError({ message: 'offline' }),
      'provider_unavailable',
      503,
      true,
    ],
    [
      'retryable API error',
      new APIError(409, { message: 'conflict' }, 'conflict', new Headers()),
      'provider_unavailable',
      502,
      true,
    ],
    [
      'server API error',
      new APIError(500, { message: 'failed' }, 'failed', new Headers()),
      'provider_unavailable',
      503,
      false,
    ],
    ['unknown error', new Error('offline'), 'provider_unavailable', 503, true],
  ] as const)(
    'maps %s to the public provider error contract',
    async (_case, error, code, statusCode, retryable) => {
      const provider = providerWith(async () => {
        throw error;
      });

      await expect(
        provider.createTurn(input, 'idempotency-key'),
      ).rejects.toMatchObject({ code, statusCode, retryable });
    },
  );
});

function providerWith(create: () => Promise<unknown>) {
  const client = { responses: { create } } as unknown as OpenAI;
  return new OpenAICoachProvider({
    apiKey: 'not-used-by-test',
    model: 'gpt-5.6-sol',
    client,
  });
}

/**
 * B183. На проде ход коуча падал `response_incomplete_max_output_tokens`:
 * усилие рассуждения подняли до `xhigh`, а потолок вывода оставили прежним.
 * Рассуждение тратит тот же бюджет, что и ответ, — усилие обязано ехать
 * вместе с местом под него. Тот же дефект был у Gemini.
 */
describe('бюджет вывода под усилие рассуждения (B183)', () => {
  it('растёт вместе с усилием и всегда оставляет место под сам ответ', () => {
    const answerOnly = outputBudgetForRole('career_expert', 'medium');
    expect(outputBudgetForRole('career_expert', 'xhigh')).toBeGreaterThan(answerOnly);
    expect(outputBudgetForRole('career_expert', 'high')).toBeGreaterThan(answerOnly);
    expect(
      outputBudgetForRole('career_expert', 'xhigh') - answerOnly,
    ).toBeGreaterThanOrEqual(answerOnly);
  });

  it('роль стратега держит больший ответ при том же усилии', () => {
    expect(outputBudgetForRole('career_strategist', 'xhigh')).toBeGreaterThan(
      outputBudgetForRole('career_expert', 'xhigh'),
    );
  });
});
