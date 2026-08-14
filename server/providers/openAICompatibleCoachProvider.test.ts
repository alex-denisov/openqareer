import type OpenAI from 'openai';
import {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  RateLimitError,
} from 'openai/error';
import { describe, expect, it } from 'vitest';
import type { CoachTurnInput } from '../domain/coach';
import {
  OpenAICompatibleCoachProvider,
  type OpenAICompatibleProviderId,
} from './openAICompatibleCoachProvider';

const input: CoachTurnInput = {
  candidateReference: 'candidate-test-001',
  dataClass: 'synthetic',
  locale: 'ru-RU',
  phase: 'discovery',
  messages: [{ id: 'message-1', role: 'user', content: 'Проверим опыт.' }],
};

const output = {
  message: 'Сначала уточним результат.',
  phase: 'evidence',
  memoryCandidates: [],
  nextQuestion: 'Что изменилось?',
  completeness: { known: ['Есть опыт'], unknown: ['Результат'] },
  safety: { needsHuman: false, reason: null },
};

describe('OpenAI-compatible provider connectors', () => {
  for (const provider of [
    'fireworks',
    'groq',
    'mistral',
    'cerebras',
    'kilocode',
    'nvidia',
    'opencode_zen',
    'tokenrouter',
    'sambanova',
    'pollinations',
    'huggingface',
  ] as const satisfies readonly OpenAICompatibleProviderId[]) {
    it(`normalizes ${provider} output to the coach contract`, async () => {
      const calls: Record<string, unknown>[] = [];
      const client = {
        chat: {
          completions: {
            create: async (body: Record<string, unknown>) => {
              calls.push(body);
              return {
                id: `${provider}-response`,
                model: `${provider}-model`,
                choices: [
                  { message: { content: JSON.stringify(output) } },
                ],
                usage: {
                  prompt_tokens: 10,
                  completion_tokens: 20,
                  total_tokens: 30,
                },
              };
            },
          },
        },
      } as unknown as OpenAI;
      const connector = new OpenAICompatibleCoachProvider({
        provider,
        apiKey: 'not-used-by-test',
        baseUrl: 'https://provider.invalid/v1',
        model: `${provider}-model`,
        structuredOutput: true,
        client,
      });

      const result = await connector.createTurn(input, 'idempotency-key');

      expect(result).toMatchObject({
        provider,
        model: `${provider}-model`,
        result: output,
        usage: { totalTokens: 30 },
      });
      expect(calls[0]).toHaveProperty(
        'response_format.type',
        'json_schema',
      );
    });
  }

  it('omits unsupported schema options and forwards explicit reasoning effort', async () => {
    const calls: Record<string, unknown>[] = [];
    const connector = connectorWith(async (body) => {
      calls.push(body);
      return compatibleResponse(JSON.stringify(output));
    }, {
      structuredOutput: false,
      reasoningEffort: 'high',
    });

    await connector.createTurn(input, 'idempotency-key');

    expect(calls[0]).not.toHaveProperty('response_format');
    expect(calls[0]).toHaveProperty('reasoning_effort', 'high');
  });

  it.each([
    ['missing content', undefined],
    ['malformed JSON', '{not-json'],
    ['schema mismatch', '{}'],
  ])('fails closed on %s', async (_case, content) => {
    const connector = connectorWith(async () => compatibleResponse(content));

    await expect(
      connector.createTurn(input, 'idempotency-key'),
    ).rejects.toMatchObject({
      code: 'provider_output_invalid',
      statusCode: 502,
      retryable: true,
    });
  });

  it.each([
    [
      'rate limit',
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
      'upstream client error',
      new APIError(400, { message: 'bad request' }, 'bad request', new Headers()),
      'provider_unavailable',
      502,
      false,
    ],
    [
      'upstream server error',
      new APIError(500, { message: 'failed' }, 'failed', new Headers()),
      'provider_unavailable',
      503,
      false,
    ],
    ['unknown transport error', new Error('offline'), 'provider_unavailable', 503, true],
  ] as const)(
    'maps %s to a typed safe error',
    async (_case, error, code, statusCode, retryable) => {
      const connector = connectorWith(async () => {
        throw error;
      });

      await expect(
        connector.createTurn(input, 'idempotency-key'),
      ).rejects.toMatchObject({ code, statusCode, retryable });
    },
  );
});

function connectorWith(
  create: (body: Record<string, unknown>) => Promise<unknown>,
  options: { structuredOutput?: boolean; reasoningEffort?: 'high' } = {},
) {
  const client = {
    chat: { completions: { create } },
  } as unknown as OpenAI;
  return new OpenAICompatibleCoachProvider({
    provider: 'groq',
    apiKey: 'not-used-by-test',
    baseUrl: 'https://provider.invalid/v1',
    model: 'provider-model',
    structuredOutput: options.structuredOutput ?? true,
    reasoningEffort: options.reasoningEffort,
    client,
  });
}

function compatibleResponse(content: string | undefined) {
  return {
    id: 'provider-response',
    model: 'provider-model',
    choices: [{ message: { content } }],
  };
}
