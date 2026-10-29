import type OpenAI from 'openai';
import { describe, expect, it } from 'vitest';
import type { CoachTurnInput } from '../domain/coach';
import type { CoachProvider } from './coachProvider';
import { HygienicCoachProvider } from './hygienicCoachProvider';
import { OpenRouterCoachProvider } from './openRouterCoachProvider';
import { ResilientCoachProvider } from './resilientCoachProvider';

const input: CoachTurnInput = {
  candidateReference: 'candidate-test-001',
  dataClass: 'personal',
  locale: 'ru-RU',
  phase: 'discovery',
  messages: [{ id: 'message-1', role: 'user', content: 'Тестовый вопрос' }],
};

/** The first model streams half a reply, then its JSON breaks the schema. */
function brokenRouterStage(): CoachProvider {
  const create = async () => ({
    async *[Symbol.asyncIterator]() {
      yield {
        id: 'gen-1',
        model: 'm',
        choices: [{ delta: { content: '{"message":"Первая​ ступ' } }],
      };
      yield { id: 'gen-1', model: 'm', choices: [{ delta: { content: 'ень","phase":42}' } }] };
    },
  });
  return new OpenRouterCoachProvider({
    apiKey: 'not-used-by-test',
    model: 'deepseek/deepseek-v4.1-flash-1017',
    structuredOutput: true,
    client: { chat: { completions: { create } } } as unknown as OpenAI,
  });
}

const fallbackStage: CoachProvider = {
  async createTurn(_input, _key, options) {
    options?.onMessageText?.('Вто');
    options?.onMessageText?.('Второй ответ.');
    return {
      provider: 'openai',
      model: 'gpt-5.6-luna',
      responseId: 'r2',
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      result: {
        message: 'Второй ответ.',
        phase: 'discovery',
        memoryCandidates: [],
        nextQuestion: null,
        completeness: { known: [], unknown: [] },
        safety: { needsHuman: false, reason: null },
        careerTrack: null,
        actionProposals: [],
      },
    };
  },
};

describe('fallback in the middle of a stream (29.10)', () => {
  it('resets what the failed model showed, cleans it, and streams the next model from scratch', async () => {
    const provider = new HygienicCoachProvider({
      inner: new ResilientCoachProvider({
        routes: [
          {
            id: 'openrouter',
            model: 'deepseek/deepseek-v4.1-flash-1017',
            provider: brokenRouterStage(),
          },
          { id: 'openai', model: 'gpt-5.6-luna', provider: fallbackStage },
        ],
        now: () => 1_000,
      }),
    });
    const seen: string[] = [];

    const output = await provider.createTurn(input, '15151515-1515-4515-8515-151515151515', {
      onMessageText: (text) => seen.push(text),
    });

    expect(output.result.message).toBe('Второй ответ.');
    expect(output.routing?.attempts).toMatchObject([
      { provider: 'openrouter', status: 'failed', code: 'provider_output_invalid' },
      { provider: 'openai', status: 'succeeded' },
    ]);
    // The hidden marker never reaches the reader; the reset precedes the second model's text.
    expect(seen).toEqual(['Первая ступ', 'Первая ступень', '', 'Вто', 'Второй ответ.']);
  });
});
