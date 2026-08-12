import { describe, expect, it } from 'vitest';
import type { CoachTurnInput } from '../domain/coach';
import { CoachProviderError, type CoachProvider } from './coachProvider';
import { ResilientCoachProvider } from './resilientCoachProvider';

const input: CoachTurnInput = {
  candidateReference: 'candidate-test-001',
  dataClass: 'synthetic',
  locale: 'ru-RU',
  phase: 'discovery',
  messages: [{ id: 'message-1', role: 'user', content: 'Тестовый вопрос' }],
};

describe('ResilientCoachProvider', () => {
  it('cools a rate-limited provider and returns visible fallback provenance', async () => {
    let primaryCalls = 0;
    const primary: CoachProvider = {
      async createTurn() {
        primaryCalls += 1;
        throw new CoachProviderError('provider_rate_limited', 429, true);
      },
    };
    const fallback: CoachProvider = {
      async createTurn() {
        return result('nvidia');
      },
    };
    const provider = new ResilientCoachProvider({
      routes: [
        { id: 'openrouter', provider: primary },
        { id: 'nvidia', provider: fallback },
      ],
      cooldownMs: 60_000,
      now: () => 1_000,
    });

    const first = await provider.createTurn(
      input,
      '55555555-5555-4555-8555-555555555555',
    );
    const second = await provider.createTurn(
      input,
      '66666666-6666-4666-8666-666666666666',
    );

    expect(primaryCalls).toBe(1);
    expect(first.routing).toMatchObject({
      fallbackUsed: true,
      attempts: [
        { provider: 'openrouter', status: 'failed', code: 'provider_rate_limited' },
        { provider: 'nvidia', status: 'succeeded' },
      ],
    });
    expect(second.routing?.attempts[0]).toMatchObject({
      provider: 'openrouter',
      status: 'skipped',
      code: 'provider_cooldown',
    });
  });
});

function result(provider: 'nvidia') {
  return {
    provider,
    model: 'nvidia/nemotron-3-super-120b-a12b',
    responseId: 'response-fallback',
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    result: {
      message: 'Fallback response',
      phase: 'discovery' as const,
      memoryCandidates: [],
      nextQuestion: 'Что уточнить?',
      completeness: { known: [], unknown: ['Цель'] },
      safety: { needsHuman: false, reason: null },
      careerTrack: null,
      actionProposals: [],
    },
  };
}
