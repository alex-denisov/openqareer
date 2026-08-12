import { describe, expect, it } from 'vitest';
import type { CoachTurnInput } from '../domain/coach';
import type { CoachProvider } from '../providers/coachProvider';
import { CoachProviderRoleAgent } from './coachProviderRoleAgent';

describe('CoachProviderRoleAgent', () => {
  it('passes an isolated role and bounded prior contributions to the provider', async () => {
    let received: CoachTurnInput | undefined;
    const provider: CoachProvider = {
      async createTurn(input) {
        received = input;
        return {
          provider: 'openai',
          model: 'gpt-5.6-sol',
          responseId: 'response-1',
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          result: {
            message: 'Стратегия',
            phase: 'market',
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
    const agent = new CoachProviderRoleAgent({ provider });

    await agent.run({
      role: 'career_strategist',
      input: {
        candidateReference: 'candidate-test-001',
        dataClass: 'synthetic',
        locale: 'ru-RU',
        phase: 'market',
        messages: [
          { id: 'message-1', role: 'user', content: 'Какой маршрут выбрать?' },
        ],
      },
      priorContributions: [
        {
          role: 'career_expert',
          summary: 'Спрос подтверждён пятью вакансиями.',
          evidenceRefs: ['message-1'],
          unknowns: ['Уровень немецкого'],
        },
      ],
      idempotencyKey: '33333333-3333-4333-8333-333333333333',
    });

    expect(received).toMatchObject({
      activeRole: 'career_strategist',
      priorRoleContributions: [
        {
          role: 'career_expert',
          evidenceRefs: ['message-1'],
        },
      ],
    });
  });
});
