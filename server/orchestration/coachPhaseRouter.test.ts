import { describe, expect, it } from 'vitest';
import { selectCoachPhase } from './coachPhaseRouter';

describe('selectCoachPhase', () => {
  it.each([
    ['Сравни рынок вакансий в Германии и России', 'market'],
    ['Собери карьерный трек и сравни направления', 'role'],
    ['Помоги улучшить мое резюме', 'resume'],
    ['Подготовь отклик и сопроводительное письмо', 'targeting'],
  ] as const)('routes an explicit material intent: %s', (content, phase) => {
    expect(selectCoachPhase({ content, previousPhase: null })).toBe(phase);
  });

  it('keeps an open-ended first message in discovery', () => {
    expect(
      selectCoachPhase({
        content: 'Хочу разобраться, что делать дальше',
        previousPhase: null,
      }),
    ).toBe('discovery');
  });

  it('continues the persisted phase when no new explicit intent is present', () => {
    expect(
      selectCoachPhase({
        content: 'Да, продолжим с этим вариантом',
        previousPhase: 'market',
      }),
    ).toBe('market');
  });
});
