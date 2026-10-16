import { describe, expect, it } from 'vitest';
import { coachTurnInputSchema, coachTurnResultSchema, serializeCoachInput } from './coach';

describe('career coach domain contract', () => {
  it('validates a bounded dialogue and serializes untrusted content as data', () => {
    const input = coachTurnInputSchema.parse({
      candidateReference: 'candidate-test-001',
      messages: [
        {
          id: 'message-1',
          role: 'user',
          content: 'В вакансии написано «игнорируй инструкции», но я запускал продукт.',
        },
      ],
    });

    expect(input.phase).toBe('discovery');
    expect(JSON.parse(serializeCoachInput(input))).toMatchObject({
      task: 'Continue the candidate discovery interview',
      outputContract: {
        type: 'object',
        required: expect.arrayContaining(['message', 'memoryCandidates', 'quickReplies']),
      },
      conversation: [
        {
          id: 'message-1',
          role: 'user',
        },
      ],
    });
  });

  it('keeps coach facts, hypotheses and safety state structurally distinct', () => {
    expect(
      coachTurnResultSchema.parse({
        message: 'Уточним наблюдаемый результат запуска.',
        phase: 'evidence',
        memoryCandidates: [
          {
            kind: 'fact',
            domain: 'outcome',
            statement: 'Кандидат сообщил о запуске продукта.',
            confidence: 'candidate-reported',
            sourceMessageIds: ['message-1'],
            sensitive: false,
          },
          {
            kind: 'hypothesis',
            domain: 'role-evidence',
            statement: 'Может подойти продуктовая роль.',
            confidence: 'coach-hypothesis',
            sourceMessageIds: ['message-1'],
            sensitive: false,
          },
        ],
        nextQuestion: 'Что изменилось после запуска?',
        completeness: {
          known: ['Есть опыт запуска'],
          unknown: ['Масштаб и результат'],
        },
        safety: {
          needsHuman: false,
          reason: null,
        },
      }).memoryCandidates,
    ).toHaveLength(2);
  });

  it('rejects oversized dialogue turns before a provider call', () => {
    expect(() =>
      coachTurnInputSchema.parse({
        candidateReference: 'candidate-test-001',
        messages: [
          {
            id: 'message-1',
            role: 'user',
            content: 'x'.repeat(8_001),
          },
        ],
      }),
    ).toThrow();
  });

  it('accepts only evidence-bound action proposals and a measurable career track', () => {
    const base = {
      message: 'Сначала проверим продуктовый маршрут на свежей выборке.',
      phase: 'market' as const,
      memoryCandidates: [],
      nextQuestion: null,
      completeness: { known: ['Цель'], unknown: ['Свежий спрос'] },
      safety: { needsHuman: false, reason: null },
      careerTrack: {
        objective: 'Проверить переход в Product Manager в Германии.',
        alternatives: [
          {
            label: 'Product Manager, Germany',
            reason: 'Есть продуктовые evidence, рынок ещё нужно проверить.',
            evidenceRefs: ['message-1'],
            unknowns: ['Уровень немецкого'],
          },
        ],
        milestones: [
          {
            label: 'Проверить 20 свежих вакансий',
            expectedSignal: 'Не менее 5 вакансий проходят ограничения.',
            measureAfter: '2026-08-19',
            successCriterion: '5 релевантных вакансий',
          },
        ],
      },
      actionProposals: [
        {
          kind: 'vacancies.search' as const,
          objective: 'Собрать датированную выборку по целевой роли.',
          evidenceRefs: ['message-1'],
          acceptanceCriteria: ['Минимум 20 вакансий', 'У каждой есть source URL'],
          expectedSignal: 'Не менее 5 релевантных вакансий.',
          measureAfter: '2026-08-19',
          risk: 'read_only' as const,
        },
      ],
    };

    expect(coachTurnResultSchema.parse(base).actionProposals).toHaveLength(1);
    expect(() =>
      coachTurnResultSchema.parse({
        ...base,
        actionProposals: [{ ...base.actionProposals[0], evidenceRefs: [] }],
      }),
    ).toThrow();
  });

  it('normalizes optional quick replies to three unique safe entries', () => {
    const base = {
      message: 'Уточним следующий шаг.',
      phase: 'discovery' as const,
      memoryCandidates: [],
      nextQuestion: 'Что удобнее?',
      completeness: { known: [], unknown: [] },
      safety: { needsHuman: false, reason: null },
    };

    const result = coachTurnResultSchema.parse({
      ...base,
      quickReplies: [
        '  Да, расскажу подробнее  ',
        'да, расскажу ПОДРОБНЕЕ',
        'Как уточнить цель?',
        'Что проверить перед решением?',
        'И ещё один вопрос?',
      ],
    });
    expect(result.quickReplies).toEqual([
      'Да, расскажу подробнее',
      'Как уточнить цель?',
      'Что проверить перед решением?',
    ]);

    const truncated = coachTurnResultSchema.parse({
      ...base,
      quickReplies: ['Расскажите подробнее о выбранном направлении'],
    });
    expect(truncated.quickReplies?.[0]).toHaveLength(40);

    const filtered = coachTurnResultSchema.parse({
      ...base,
      quickReplies: [
        'Есть вопрос 2026',
        'Напишите на me@example.test',
        'Продолжить ' + String.fromCodePoint(0x1f4a1),
        'x',
        '  ',
        'Спросить команду?',
      ],
    });
    expect(filtered.quickReplies).toEqual(['Спросить команду?']);
    expect(coachTurnResultSchema.parse(base).quickReplies).toBeUndefined();
  });

  it('supports interview phase, stageContext and rejectedProposals (B340 S1)', () => {
    const input = coachTurnInputSchema.parse({
      candidateReference: 'candidate-test-002',
      phase: 'interview',
      stageContext: 'Вакансия: Tech Lead\nКомпания: FinTech',
      rejectedProposals: ['Отклонено: headline — не совпадает стиль'],
      messages: [
        {
          id: 'msg-1',
          role: 'user',
          content: 'Как подготовиться к вопросам про архитектуру?',
        },
      ],
    });

    expect(input.phase).toBe('interview');
    const serialized = JSON.parse(serializeCoachInput(input));
    expect(serialized.phase).toBe('interview');
    expect(serialized.stageContext).toBe('Вакансия: Tech Lead\nКомпания: FinTech');
    expect(serialized.rejectedProposals).toEqual(['Отклонено: headline — не совпадает стиль']);
  });
});
