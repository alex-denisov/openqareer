import { describe, expect, it } from 'vitest';
import type { BulkCompletion } from '../domain/measuredBulkClient';
import { extractCandidateFacts, splitAnswer } from './candidateFactExtractor';

const MESSAGE_ID = 'message-1';

function bulkAnswering(answers: (input: string) => unknown): BulkCompletion & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async complete(input) {
      calls.push(input.input);
      return {
        content: JSON.stringify(answers(input.input)),
        model: 'deepseek/deepseek-v4-flash',
        provider: 'DeepSeek',
        usage: { cost: 0.0004, promptTokens: 900, cachedTokens: 0, completionTokens: 300 },
      };
    },
  };
}

describe('splitAnswer', () => {
  it('cuts a long answer at sentence ends into parts of at most 1500 characters', () => {
    const answer = 'Руководил командой из 254 человек. '.repeat(120);
    const parts = splitAnswer(answer);
    expect(parts.length).toBeGreaterThan(2);
    expect(parts.every((part) => part.length <= 1500)).toBe(true);
    expect(parts.join(' ').replace(/\s+/g, ' ').trim()).toBe(answer.replace(/\s+/g, ' ').trim());
  });
});

describe('extractCandidateFacts', () => {
  it('asks the bulk model once per part, in parallel, and keeps every sourced fact', async () => {
    const answer =
      'Выручка выросла с 230 до 920 миллионов рублей. '.repeat(40) +
      'Лично нанял около 30 человек.';
    const bulk = bulkAnswering((input) =>
      input.includes('30 человек')
        ? {
            facts: [
              { kind: 'fact', domain: 'responsibility', statement: 'Лично нанял около 30 человек' },
            ],
          }
        : {
            facts: [
              {
                kind: 'fact',
                domain: 'outcome',
                statement: 'Выручка выросла с 230 до 920 млн руб.',
              },
            ],
          },
    );

    const result = await extractCandidateFacts({
      bulk,
      messageId: MESSAGE_ID,
      answer,
      runId: 'turn-1',
    });

    expect(bulk.calls.length).toBe(splitAnswer(answer).length);
    expect(result.facts.map((fact) => fact.statement)).toEqual([
      'Выручка выросла с 230 до 920 млн руб.',
      'Лично нанял около 30 человек',
    ]);
    expect(result.facts[0]).toMatchObject({
      kind: 'fact',
      confidence: 'candidate-reported',
      sourceMessageIds: [MESSAGE_ID],
      sensitive: false,
    });
    expect(result.cost).toBeCloseTo(0.0004 * bulk.calls.length);
  });

  it('drops a fact whose number the candidate did not say, and one already in the profile', async () => {
    const bulk = bulkAnswering(() => ({
      facts: [
        { kind: 'fact', domain: 'outcome', statement: 'Компания продана за $70 млн' },
        { kind: 'fact', domain: 'responsibility', statement: 'Команда 254 человека' },
        { kind: 'preference', domain: 'preference', statement: 'Готов к гибриду' },
      ],
    }));
    const answer =
      'Точно было 254 человека. Компания стоила 50 миллионов. Готов к гибриду и офису. '.repeat(5);

    const result = await extractCandidateFacts({
      bulk,
      messageId: MESSAGE_ID,
      answer,
      runId: 'turn-2',
      known: ['команда 254 человека'],
    });

    expect(result.facts.map((fact) => fact.statement)).toEqual(['Готов к гибриду']);
  });

  it('returns no facts and the error when the bulk model fails, never throws', async () => {
    const bulk: BulkCompletion = {
      async complete() {
        throw new Error('Bulk budget exceeded');
      },
    };
    const result = await extractCandidateFacts({
      bulk,
      messageId: MESSAGE_ID,
      answer: 'Руководил командой. '.repeat(30),
      runId: 'turn-3',
    });
    expect(result.facts).toEqual([]);
    expect(result.failures).toEqual(['Bulk budget exceeded']);
  });

  it('skips a short question', async () => {
    const bulk = bulkAnswering(() => ({ facts: [] }));
    const result = await extractCandidateFacts({
      bulk,
      messageId: MESSAGE_ID,
      answer: 'Какие роли мне подходят?',
      runId: 'turn-4',
    });
    expect(bulk.calls).toEqual([]);
    expect(result.facts).toEqual([]);
  });
});
