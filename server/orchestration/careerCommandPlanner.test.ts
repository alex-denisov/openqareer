import { describe, expect, it } from 'vitest';
import {
  CareerCommandPlanner,
  CareerCommandPolicyError,
} from './careerCommandPlanner';

describe('CareerCommandPlanner', () => {
  it('keeps an external side effect awaiting server-verified candidate approval', () => {
    const planner = new CareerCommandPlanner({
      createId: () => 'command-1',
      now: () => new Date('2026-08-12T14:00:00.000Z'),
    });

    const command = planner.materialize({
      principal: { candidateId: 'candidate-server-scope' },
      proposal: {
        kind: 'application.submit',
        objective: 'Отправить подготовленный отклик на выбранную вакансию.',
        evidenceRefs: ['evidence-1'],
        acceptanceCriteria: ['Получен внешний receipt'],
        expectedSignal: 'Отклик зарегистрирован площадкой.',
        measureAfter: '2026-08-19',
        risk: 'external_side_effect',
      },
      availableEvidenceRefs: new Set(['evidence-1']),
      strategyDecisionId: 'strategy-1',
      modelInvocationIds: ['response-expert', 'response-strategist'],
      idempotencyKey: '44444444-4444-4444-8444-444444444444',
      approval: null,
    });

    expect(command).toMatchObject({
      schemaVersion: 'career-command-v1',
      commandId: 'command-1',
      candidateId: 'candidate-server-scope',
      capability: 'application.submit',
      status: 'awaiting_approval',
      idempotency: {
        key: '44444444-4444-4444-8444-444444444444',
        semantics: 'at_most_once',
      },
      authorization: { approvalId: null },
    });
  });

  it('materializes a read-only proposal without inventing execution', () => {
    const planner = new CareerCommandPlanner({
      createId: () => 'command-2',
      now: () => new Date('2026-08-12T14:00:00.000Z'),
    });

    const command = planner.materialize({
      principal: { candidateId: 'candidate-server-scope' },
      proposal: {
        kind: 'vacancies.search',
        objective: 'Собрать датированную выборку вакансий.',
        evidenceRefs: ['evidence-1'],
        acceptanceCriteria: ['Есть минимум двадцать источников'],
        expectedSignal: 'Пять релевантных вакансий.',
        measureAfter: '2026-08-19',
        risk: 'read_only',
      },
      availableEvidenceRefs: new Set(['evidence-1']),
      strategyDecisionId: 'strategy-1',
      modelInvocationIds: ['response-strategist'],
      idempotencyKey: '55555555-5555-4555-8555-555555555555',
      approval: null,
    });

    expect(command.status).toBe('prepared');
  });

  it('rejects a non-dispatchable capability disguised as an external write', () => {
    const planner = new CareerCommandPlanner({ createId: () => 'command-3' });

    expect(() =>
      planner.materialize({
        principal: { candidateId: 'candidate-server-scope' },
        proposal: {
          kind: 'resume.draft',
          objective: 'Создать черновик резюме.',
          evidenceRefs: ['evidence-1'],
          acceptanceCriteria: ['Черновик создан'],
          expectedSignal: 'Кандидат видит черновик.',
          measureAfter: '2026-08-19',
          risk: 'external_side_effect',
        },
        availableEvidenceRefs: new Set(['evidence-1']),
        strategyDecisionId: 'strategy-1',
        modelInvocationIds: ['response-strategist'],
        idempotencyKey: '66666666-6666-4666-8666-666666666666',
        approval: null,
      }),
    ).toThrowError(
      expect.objectContaining<Partial<CareerCommandPolicyError>>({
        code: 'invalid_capability_risk',
      }),
    );
  });
});
