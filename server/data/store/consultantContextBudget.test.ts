import { describe, expect, it } from 'vitest';
import type { CoachTurnInput } from '../../domain/coach';
import { estimateContextTokens, fitConsultantHistoryContext } from './consultantContextBudget';

const fact = {
  ref: 'memory:fact-1',
  kind: 'fact' as const,
  domain: 'outcome' as const,
  statement: 'Проверенный факт, который нельзя обрезать.',
  sourceRefs: ['source-1'],
  sensitive: false,
  source: 'confirmed' as const,
};

describe('consultant history context budget (B436)', () => {
  it('drops FTS snippets before old summaries and preserves Evidence Base facts', () => {
    const base: NonNullable<CoachTurnInput['knowledgeContext']> = {
      confirmedFacts: [fact],
      documents: [],
      openQuestions: [],
    };
    const history = {
      summaries: [2, 1, 0].map((index) => ({
        ref: `summary-${index}`,
        stage: 'profile' as const,
        createdAt: `2026-10-0${index + 1}T10:00:00.000Z`,
        summary: 'Краткая выжимка '.repeat(100),
      })),
      messageSnippets: [2, 1, 0].map((index) => ({
        ref: `message-${index}`,
        stage: 'profile' as const,
        role: 'user' as const,
        createdAt: `2026-10-0${index + 1}T10:00:00.000Z`,
        content: 'Фрагмент поиска '.repeat(100),
      })),
    };
    const summaryOnlyTokens = estimateContextTokens({
      ...base,
      consultantHistory: { summaries: history.summaries, messageSnippets: [] },
    });
    const fitted = fitConsultantHistoryContext(base, history, summaryOnlyTokens);

    expect(fitted.confirmedFacts).toEqual([fact]);
    expect(fitted.consultantHistory?.messageSnippets).toEqual([]);
    expect(fitted.consultantHistory?.summaries).toEqual(history.summaries);
    expect(estimateContextTokens(fitted)).toBeLessThanOrEqual(summaryOnlyTokens);
  });

  it('removes older summaries after all FTS snippets are dropped', () => {
    const base: NonNullable<CoachTurnInput['knowledgeContext']> = {
      confirmedFacts: [fact],
      documents: [],
      openQuestions: [],
    };
    const history = {
      summaries: [2, 1, 0].map((index) => ({
        ref: `summary-${index}`,
        stage: 'career' as const,
        createdAt: `2026-10-0${index + 1}T10:00:00.000Z`,
        summary: `Summary ${index}. `.repeat(45),
      })),
      messageSnippets: [2, 1, 0].map((index) => ({
        ref: `message-${index}`,
        stage: 'career' as const,
        role: 'assistant' as const,
        createdAt: `2026-10-0${index + 1}T10:00:00.000Z`,
        content: `Snippet ${index}. `.repeat(45),
      })),
    };
    const newestSummaryTokens = estimateContextTokens({
      ...base,
      consultantHistory: { summaries: [history.summaries[0]!], messageSnippets: [] },
    });
    const fitted = fitConsultantHistoryContext(base, history, newestSummaryTokens);

    expect(fitted.consultantHistory?.messageSnippets).toEqual([]);
    expect(fitted.consultantHistory?.summaries).toEqual([history.summaries[0]]);
    expect(fitted.confirmedFacts).toEqual([fact]);
  });
});
