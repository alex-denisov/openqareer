import { describe, expect, it } from 'vitest';
import type { CoachTurnInput } from './coach';
import { serializeCoachInput } from './coachInputSerialization';
import { correctionCards, type FactSource } from './factCorrectionProposals';

const source = {
  memory: [],
  resume: { draft: { candidate: { about: 'Рентабельность с 16% до 80%' }, experience: [] } },
} as unknown as FactSource;

describe('B796: консультант знает о карточке под репликой', () => {
  it('карточка названа местом и числами, без исправления её нет', () => {
    expect(correctionCards(source, 'Исправь: не 80 %, а 40 %')).toEqual([
      { place: 'О себе', from: '80', to: '40' },
    ]);
    expect(correctionCards(source, 'Что дальше?')).toEqual([]);
    expect(correctionCards(source, 'Исправь: не 70 %, а 40 %')).toEqual([]);
  });

  it('карточка доходит до модели', () => {
    const input = {
      dataClass: 'personal',
      locale: 'ru-RU',
      phase: 'discovery',
      messages: [],
    } as unknown as CoachTurnInput;
    const cards = [{ place: 'О себе', from: '80', to: '40' }];
    expect(
      JSON.parse(serializeCoachInput({ ...input, correctionCards: cards })).correctionCards,
    ).toEqual(cards);
    expect(serializeCoachInput(input)).not.toContain('"correctionCards"');
  });
});
