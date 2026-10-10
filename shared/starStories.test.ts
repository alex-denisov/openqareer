import { describe, expect, it } from 'vitest';
import { starStoryEvidenceStatus } from './starStories';

describe('STAR story evidence status', () => {
  it('confirms a result when every number appears in a linked fact', () => {
    expect(
      starStoryEvidenceStatus(
        'Сократил цикл с 14 до 3 дней.',
        ['fact-1'],
        [{ id: 'fact-1', statement: 'Сократил цикл релиза с 14 до 3 дней.' }],
      ),
    ).toBe('confirmed');
  });

  it('keeps a story unconfirmed without facts or with an unsupported number', () => {
    expect(starStoryEvidenceStatus('Ускорил релиз.', [], [])).toBe('unconfirmed');
    expect(
      starStoryEvidenceStatus(
        'Сократил цикл с 14 до 4 дней.',
        ['fact-1'],
        [{ id: 'fact-1', statement: 'Сократил цикл релиза с 14 до 3 дней.' }],
      ),
    ).toBe('unconfirmed');
  });

  it('normalizes decimal commas and marks missing sources unconfirmed', () => {
    expect(
      starStoryEvidenceStatus(
        'Снизил расходы на 12,5%.',
        ['fact-1'],
        [{ id: 'fact-1', statement: 'Снижение расходов составило 12.5 процентов.' }],
      ),
    ).toBe('confirmed');
    expect(starStoryEvidenceStatus('Снизил расходы на 12,5%.', ['missing'], [])).toBe(
      'unconfirmed',
    );
  });
});
