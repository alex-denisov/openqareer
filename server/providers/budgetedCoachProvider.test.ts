import { describe, expect, it } from 'vitest';
import type { CoachTurnInput } from '../domain/coach';
import { estimateCoachTurnTokens } from '../domain/coachInputBudget';
import { BudgetedCoachProvider } from './budgetedCoachProvider';
import type { CoachProvider, CoachProviderResult } from './coachProvider';

const messages = Array.from({ length: 30 }, (_, index) => ({
  id: `m${index}`,
  role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
  content: 'расскажите про опыт руководства платформой '.repeat(70),
}));
const input: CoachTurnInput = {
  candidateReference: 'candidate-test-001',
  dataClass: 'personal',
  locale: 'ru-RU',
  phase: 'discovery',
  messages,
};

describe('budgeted coach provider (B580)', () => {
  it('sends every stage of the chain a turn within 16K tokens', async () => {
    const seen: CoachTurnInput[] = [];
    const inner: CoachProvider = {
      createTurn: async (turn) => {
        seen.push(turn);
        return { provider: 'openrouter' } as unknown as CoachProviderResult;
      },
    };

    await new BudgetedCoachProvider({ inner }).createTurn(input, 'key-1');

    expect(estimateCoachTurnTokens(input)).toBeGreaterThan(16_000);
    expect(estimateCoachTurnTokens(seen[0]!)).toBeLessThanOrEqual(16_000);
    expect(seen[0]!.messages.at(-1)).toEqual(messages.at(-1));
  });
});
