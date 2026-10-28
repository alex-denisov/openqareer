import { describe, expect, it } from 'vitest';
import type { CoachTurnInput } from './coach';
import {
  COACH_TURN_INPUT_TOKEN_LIMIT,
  estimateCoachTurnTokens,
  fitCoachTurnInput,
} from './coachInputBudget';
import { serializeCoachInput } from './coachInputSerialization';

const long = (label: string, chars: number) =>
  `${label} ${'опыт руководства платформой '.repeat(chars / 28)}`.slice(0, chars);

const summaries = Array.from({ length: 6 }, (_, index) => ({
  ref: `consultant-summary:s${index}`,
  stage: 'career' as const,
  createdAt: `2026-10-2${index}T10:00:00.000Z`,
  summary: long(`сводка ${index}`, 2_000),
}));

const messageSnippets = Array.from({ length: 5 }, (_, index) => ({
  ref: `consultant-message:p${index}`,
  stage: 'career' as const,
  role: 'user' as const,
  createdAt: '2026-10-20T10:00:00.000Z',
  content: long(`прошлое ${index}`, 800),
}));

const messages = Array.from({ length: 30 }, (_, index) => ({
  id: `m${index}`,
  role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
  content: long(`реплика ${index}`, 3_000),
}));

const heavy: CoachTurnInput = {
  candidateReference: 'candidate-test-001',
  dataClass: 'personal',
  locale: 'ru-RU',
  phase: 'market',
  messages,
  knowledgeContext: {
    confirmedFacts: [],
    documents: [],
    openQuestions: [],
    consultantHistory: { summaries, messageSnippets },
  },
};

describe('coach turn input budget (B580)', () => {
  it('leaves a turn that already fits untouched', () => {
    const small: CoachTurnInput = {
      ...heavy,
      messages: messages.slice(-2),
      knowledgeContext: undefined,
    };

    expect(fitCoachTurnInput(small)).toBe(small);
  });

  it('fits a long conversation into 16K tokens with the summaries and the latest messages', () => {
    expect(estimateCoachTurnTokens(heavy)).toBeGreaterThan(COACH_TURN_INPUT_TOKEN_LIMIT);

    const fitted = fitCoachTurnInput(heavy);

    expect(estimateCoachTurnTokens(fitted)).toBeLessThanOrEqual(COACH_TURN_INPUT_TOKEN_LIMIT);
    expect(fitted.messages.at(-1)).toEqual(messages.at(-1));
    expect(fitted.messages.length).toBeGreaterThanOrEqual(4);
    expect(fitted.knowledgeContext?.consultantHistory?.messageSnippets).toEqual([]);
    expect(fitted.knowledgeContext?.consultantHistory?.summaries[0]).toEqual(summaries[0]);
  });

  it('drops old messages before it drops a conversation summary', () => {
    const fitted = fitCoachTurnInput({
      ...heavy,
      knowledgeContext: {
        ...heavy.knowledgeContext!,
        consultantHistory: { summaries: summaries.slice(0, 2), messageSnippets },
      },
    });

    expect(fitted.knowledgeContext?.consultantHistory?.summaries).toHaveLength(2);
    expect(fitted.messages.length).toBeLessThan(messages.length);
  });

  it('keeps the stable prefix when it trims the conversation', () => {
    const shorter = { ...heavy, messages: messages.slice(-24) };
    const first = serializeCoachInput(fitCoachTurnInput(shorter));
    const second = serializeCoachInput(fitCoachTurnInput(heavy));
    const boundary = first.indexOf(',"phase":"market"');

    expect(second.slice(0, boundary)).toBe(first.slice(0, boundary));
  });

  it('never trims a structured stage: its task needs the whole context', () => {
    const stage: CoachTurnInput = { ...heavy, internalPurpose: 'structured-stage' };

    expect(fitCoachTurnInput(stage)).toBe(stage);
  });
});
