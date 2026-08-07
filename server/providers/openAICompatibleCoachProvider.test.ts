import type OpenAI from 'openai';
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
});
