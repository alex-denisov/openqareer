import type OpenAI from 'openai';
import { RateLimitError } from 'openai/error';
import { describe, expect, it } from 'vitest';
import type { CoachTurnInput } from '../domain/coach';
import { CoachProviderError } from './coachProvider';
import { OpenAICoachProvider } from './openAICoachProvider';

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
      reasoning: {
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
});
