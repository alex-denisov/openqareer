import { describe, expect, it } from 'vitest';
import { HygienicCoachProvider } from './hygienicCoachProvider';
import type { CoachProvider, CoachProviderResult } from './coachProvider';
import type { CoachTurnInput } from '../domain/coach';

const ZWSP = '​';
const TAG_A = '\u{E0061}';

function providerReturning(result: unknown): CoachProvider {
  return {
    createTurn: async () => result as CoachProviderResult,
  } as CoachProvider;
}

const input = { dataClass: 'personal' } as unknown as CoachTurnInput;

describe('ответ модели доходит до кандидата без невидимых меток (B210)', () => {
  it('чистит текст на любой глубине ответа', async () => {
    const provider = new HygienicCoachProvider({
      inner: providerReturning({
        result: {
          message: `Ваш${ZWSP} опыт${TAG_A}`,
          steps: [{ title: `Шаг${ZWSP} первый` }],
        },
        provider: 'openai',
        model: 'gpt',
        responseId: 'r1',
        usage: {},
      }),
    });

    const answer = await provider.createTurn(input, 'key-1');

    expect(answer.result).toEqual({
      message: 'Ваш опыт',
      steps: [{ title: 'Шаг первый' }],
    });
    expect(answer.model).toBe('gpt');
  });

  it('не пересобирает ответ, в котором чистить нечего', async () => {
    const clean = {
      result: { message: 'Чистый ответ' },
      provider: 'openai',
      model: 'gpt',
      responseId: 'r2',
      usage: {},
    };
    const provider = new HygienicCoachProvider({ inner: providerReturning(clean) });

    const answer = await provider.createTurn(input, 'key-2');

    expect(answer).toBe(clean);
  });
});
