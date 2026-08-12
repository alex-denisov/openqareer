import { describe, expect, it, vi } from 'vitest';
import type { CoachTurnInput } from '../domain/coach';
import type { CoachProvider } from './coachProvider';
import { PrivacyAwareCoachProvider } from './privacyAwareCoachProvider';

function providerNamed(
  provider: 'openai' | 'openrouter',
): CoachProvider {
  return {
    createTurn: vi.fn<CoachProvider['createTurn']>(async () => ({
      provider,
      model: provider === 'openai' ? 'gpt-5.6-sol' : 'nemotron-test',
      responseId: `${provider}-response`,
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      result: {
        message: 'Продолжаем.',
        phase: 'discovery',
        memoryCandidates: [],
        nextQuestion: 'Что для вас важно?',
        completeness: { known: [], unknown: ['Цель'] },
        safety: { needsHuman: false, reason: null },
        careerTrack: null,
        actionProposals: [],
      },
    })),
  };
}

function inputFor(
  dataClass: CoachTurnInput['dataClass'],
): CoachTurnInput {
  return {
    candidateReference: 'candidate-test-001',
    dataClass,
    locale: 'ru-RU',
    phase: 'discovery',
    messages: [
      {
        id: 'message-1',
        role: 'user',
        content: 'Хочу проверить направление поиска.',
      },
    ],
  };
}

describe('privacy-aware coach routing', () => {
  it('routes personal candidate data only to OpenAI', async () => {
    const personal = providerNamed('openai');
    const synthetic = providerNamed('openrouter');
    const provider = new PrivacyAwareCoachProvider({
      personalDataProvider: personal,
      syntheticDataProvider: synthetic,
    });

    const result = await provider.createTurn(
      inputFor('personal'),
      'idempotency-key',
    );

    expect(result.provider).toBe('openai');
    expect(personal.createTurn).toHaveBeenCalledOnce();
    expect(synthetic.createTurn).not.toHaveBeenCalled();
  });

  it('routes explicitly synthetic test data to the free provider', async () => {
    const personal = providerNamed('openai');
    const synthetic = providerNamed('openrouter');
    const provider = new PrivacyAwareCoachProvider({
      personalDataProvider: personal,
      syntheticDataProvider: synthetic,
    });

    const result = await provider.createTurn(
      inputFor('synthetic'),
      'idempotency-key',
    );

    expect(result.provider).toBe('openrouter');
    expect(synthetic.createTurn).toHaveBeenCalledOnce();
    expect(personal.createTurn).not.toHaveBeenCalled();
  });
});
