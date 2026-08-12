import type OpenAI from 'openai';
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
});
