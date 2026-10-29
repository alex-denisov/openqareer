import { describe, expect, it } from 'vitest';
import type { StoredMemory } from '../data/candidateStore';
import { conversationCoverage, isQuizCheckable } from './skillConfirmation';

function fact(overrides: Partial<StoredMemory> = {}): StoredMemory {
  return {
    id: 'm1',
    kind: 'fact',
    domain: 'outcome',
    statement: 'Руководил командой из 45 инженеров в Россети Цифра',
    confidence: 'candidate-confirmed',
    sourceMessageIds: ['msg-7'],
    sensitive: false,
    status: 'confirmed',
    provenance: { kind: 'candidate', at: '2026-10-25T09:00:00Z' },
    createdAt: '2026-10-25T09:00:00Z',
    updatedAt: '2026-10-25T09:00:00Z',
    ...overrides,
  } as StoredMemory;
}

describe('conversationCoverage', () => {
  it('marks a requirement discussed by a confirmed conversation fact with a number', () => {
    const [coverage] = conversationCoverage(['Team Leadership'], [fact()]);

    expect(coverage).toEqual({
      name: 'Team Leadership',
      state: 'discussed',
      facts: [
        {
          memoryId: 'm1',
          statement: 'Руководил командой из 45 инженеров в Россети Цифра',
          sourceMessageIds: ['msg-7'],
          at: '2026-10-25T09:00:00Z',
        },
      ],
    });
  });

  it('matches a requirement named directly in the fact', () => {
    const facts = [fact({ statement: 'Собрал 12 отчётов для финансов на SQL за квартал' })];

    expect(conversationCoverage(['SQL'], facts)[0]?.state).toBe('discussed');
  });

  it('does not match a short name inside another word', () => {
    const facts = [fact({ statement: 'Провёл 3 года в Google Cloud' })];

    expect(conversationCoverage(['Go'], facts)[0]?.state).toBe('not_checked');
  });

  it.each([
    ['a fact without a number', { statement: 'Руководил командой инженеров' }],
    ['a fact the candidate did not confirm', { status: 'proposed' as const }],
    [
      'an imported fact',
      { provenance: { kind: 'import' as const, platform: 'linkedin' as const, at: '2026-10-23' } },
    ],
    ['a fact without a reply reference', { sourceMessageIds: [] }],
    ['a hypothesis, not a fact', { kind: 'hypothesis' as const }],
  ])('leaves the requirement not checked for %s', (_label, overrides) => {
    const [coverage] = conversationCoverage(['Team Leadership'], [fact(overrides)]);

    expect(coverage).toEqual({ name: 'Team Leadership', state: 'not_checked', facts: [] });
  });

  it('counts a fact the consultant proposed and the candidate accepted', () => {
    const facts = [fact({ provenance: { kind: 'consultant', at: '2026-10-26T09:00:00Z' } })];

    expect(conversationCoverage(['Управление командой'], facts)[0]?.state).toBe('discussed');
  });
});

describe('isQuizCheckable', () => {
  it.each(['Docker', 'SQL', '1С: Бухгалтерия', 'Excel'])('offers a quiz for %s', (skill) => {
    expect(isQuizCheckable(skill)).toBe(true);
  });

  it.each(['Executive Leadership', 'Управление P&L', 'Стратегическое планирование'])(
    'offers no quiz for the management skill %s',
    (skill) => {
      expect(isQuizCheckable(skill)).toBe(false);
    },
  );
});
