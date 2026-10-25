import { describe, expect, it } from 'vitest';
import type { CoachTurnInput } from '../domain/coach';
import { faithfulMemoryCandidates } from './memoryCandidateGuard';

type Candidate = Parameters<typeof faithfulMemoryCandidates>[1][number];

const INPUT = {
  candidateReference: 'candidate-test-001',
  dataClass: 'synthetic',
  locale: 'ru-RU',
  phase: 'evidence',
  messages: [
    { id: 'assistant-1', role: 'assistant', content: 'Продали компанию за 50 млн?' },
    {
      id: 'message-1',
      role: 'user',
      content:
        'Выручка направления выросла с 230 до 920 миллионов рублей в год. Наняли лично человек 30. ' +
        'За сколько продали компанию, честно не знаю. Зарплата — минимум 600 000 ₽ на руки.',
    },
  ],
} as unknown as CoachTurnInput;

function fact(statement: string, sourceMessageIds = ['message-1']): Candidate {
  return {
    kind: 'fact',
    domain: 'outcome',
    statement,
    confidence: 'candidate-reported',
    sourceMessageIds,
    sensitive: false,
  };
}

describe('faithfulMemoryCandidates (coach facts with a source, no distortion)', () => {
  it('keeps a candidate fact whose every number is in the cited message', () => {
    const kept = faithfulMemoryCandidates(INPUT, [
      fact('Выручка направления выросла с 230 до 920 млн руб. в год'),
      fact('Минимальные зарплатные ожидания — 600 000 ₽ на руки'),
    ]);
    expect(kept.map((item) => item.statement)).toEqual([
      'Выручка направления выросла с 230 до 920 млн руб. в год',
      'Минимальные зарплатные ожидания — 600 000 ₽ на руки',
    ]);
  });

  it('drops a fact whose number the candidate never said', () => {
    expect(faithfulMemoryCandidates(INPUT, [fact('Компания продана за $50 млн')])).toEqual([]);
    expect(faithfulMemoryCandidates(INPUT, [fact('Лично нанял 35 человек')])).toEqual([]);
  });

  it('drops a candidate without a source or citing an assistant message', () => {
    expect(faithfulMemoryCandidates(INPUT, [fact('Нанял около 30 человек', [])])).toEqual([]);
    expect(
      faithfulMemoryCandidates(INPUT, [fact('Нанял около 30 человек', ['assistant-1'])]),
    ).toEqual([]);
  });

  it('keeps one copy when several roles propose the same statement', () => {
    const kept = faithfulMemoryCandidates(INPUT, [
      fact('Лично нанял около 30 человек'),
      fact('лично нанял около 30 человек.'),
    ]);
    expect(kept).toHaveLength(1);
  });

  it('checks a number against a confirmed fact it cites', () => {
    const input = {
      ...INPUT,
      knowledgeContext: {
        confirmedFacts: [
          {
            ref: 'memory:imp-1',
            kind: 'fact',
            domain: 'outcome',
            statement: 'Команда 256 человек',
            sourceRefs: [],
            sensitive: false,
            source: 'confirmed',
          },
        ],
        documents: [],
        openQuestions: [],
      },
    } as unknown as CoachTurnInput;
    const hypothesis = {
      ...fact('Опыт руководства 256 людьми подходит VP-роли', ['memory:imp-1']),
      kind: 'hypothesis' as const,
      confidence: 'coach-hypothesis' as const,
    };
    expect(faithfulMemoryCandidates(input, [hypothesis])).toHaveLength(1);
  });
});
