import { describe, expect, it } from 'vitest';
import type { CoachProviderResult } from '../providers/coachProvider';
import {
  CareerOrchestrator,
  CareerOrchestrationBudgetError,
  type CareerRole,
  type CareerRoleAgent,
} from './careerOrchestrator';

describe('CareerOrchestrator', () => {
  it('routes a material market turn through expert, strategist and consultant', async () => {
    const calls: CareerRole[] = [];
    const agent: CareerRoleAgent = {
      async run(input) {
        calls.push(input.role);
        return roleResult(input.role);
      },
    };
    const orchestrator = new CareerOrchestrator({ roleAgent: agent });

    const output = await orchestrator.createTurn(
      {
        candidateReference: 'candidate-test-001',
        dataClass: 'synthetic',
        locale: 'ru-RU',
        phase: 'market',
        messages: [
          {
            id: 'message-1',
            role: 'user',
            content: 'Сравни продуктовую роль в Германии и удалённую роль в России.',
          },
        ],
      },
      '11111111-1111-4111-8111-111111111111',
    );

    expect(calls).toEqual([
      'career_expert',
      'career_strategist',
      'career_consultant',
    ]);
    expect(output.result.message).toBe('career_consultant summary');
    expect(output.result.intelligence).toMatchObject({
      roleCoverage: [
        'career_expert',
        'career_strategist',
        'career_consultant',
      ],
      evidenceCoverage: 1,
      unsupportedClaimCount: 0,
    });
    expect(output.result.intelligence?.roleContributions).toHaveLength(3);
    expect(output.result.careerTrack?.objective).toBe('career_strategist track');
    expect(output.result.actionProposals).toEqual([
      expect.objectContaining({ kind: 'vacancies.search' }),
    ]);
    expect(output.usage.totalTokens).toBe(60);
  });

  it('fails before calling a role when the run budget cannot cover the route', async () => {
    let calls = 0;
    const orchestrator = new CareerOrchestrator({
      budget: { maxModelCalls: 2 },
      roleAgent: {
        async run() {
          calls += 1;
          return roleResult('career_consultant');
        },
      },
    });

    await expect(
      orchestrator.createTurn(
        {
          candidateReference: 'candidate-test-001',
          dataClass: 'synthetic',
          locale: 'ru-RU',
          phase: 'market',
          messages: [
            { id: 'message-1', role: 'user', content: 'Собери карьерный трек.' },
          ],
        },
        '22222222-2222-4222-8222-222222222222',
      ),
    ).rejects.toBeInstanceOf(CareerOrchestrationBudgetError);
    expect(calls).toBe(0);
  });

  it('never treats a prior assistant message as candidate evidence', async () => {
    const orchestrator = new CareerOrchestrator({
      roleAgent: {
        async run(input) {
          const output = roleResult(input.role);
          if (input.role === 'career_strategist') {
            output.result.actionProposals[0].evidenceRefs = ['assistant-1'];
          }
          return output;
        },
      },
    });

    const output = await orchestrator.createTurn(
      {
        candidateReference: 'candidate-test-001',
        dataClass: 'synthetic',
        locale: 'ru-RU',
        phase: 'market',
        messages: [
          { id: 'assistant-1', role: 'assistant', content: 'Гипотеза модели.' },
          { id: 'message-1', role: 'user', content: 'Проверим рынок.' },
        ],
      },
      '33333333-3333-4333-8333-333333333333',
    );

    expect(output.result.actionProposals).toEqual([]);
  });
});

function roleResult(role: CareerRole): CoachProviderResult {
  return {
    provider: 'openai',
    model: 'gpt-5.6-sol',
    responseId: `response-${role}`,
    usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
    result: {
      message: `${role} summary`,
      phase: 'market',
      memoryCandidates: [
        {
          kind: role === 'career_expert' ? 'fact' : 'hypothesis',
          domain: 'role-evidence',
          statement: `${role} statement`,
          confidence:
            role === 'career_expert'
              ? 'candidate-reported'
              : 'coach-hypothesis',
          sourceMessageIds: ['message-1'],
          sensitive: false,
        },
      ],
      nextQuestion:
        role === 'career_consultant' ? 'Какой маршрут проверить первым?' : null,
      completeness: { known: ['Целевые рынки'], unknown: [] },
      safety: { needsHuman: false, reason: null },
      careerTrack:
        role === 'career_strategist'
          ? {
              objective: 'career_strategist track',
              alternatives: [
                {
                  label: 'Product route',
                  reason: 'Evidence-bound experiment',
                  evidenceRefs: ['message-1'],
                  unknowns: [],
                },
              ],
              milestones: [
                {
                  label: 'Search vacancies',
                  expectedSignal: 'Five relevant vacancies',
                  measureAfter: '2026-08-19',
                  successCriterion: 'Five matching vacancies',
                },
              ],
            }
          : null,
      actionProposals:
        role === 'career_strategist'
          ? [
              {
                kind: 'vacancies.search',
                objective: 'Collect fresh market evidence',
                evidenceRefs: ['message-1'],
                acceptanceCriteria: ['At least twenty sourced vacancies'],
                expectedSignal: 'Five relevant vacancies',
                measureAfter: '2026-08-19',
                risk: 'read_only',
              },
            ]
          : [],
    },
  };
}
