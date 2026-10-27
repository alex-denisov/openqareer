import { describe, expect, it } from 'vitest';
import { requestedSalaryFloor, withSalaryFloorProposal } from './careerConditionClaim';
import type { CoachTurnInput, CoachTurnResult } from './coach';

const ask = 'Подними нижнюю границу зарплаты в условиях поиска до 800 000 ₽ на руки — ниже я не рассматриваю.';

function input(content: string, floor: number | null = 600_000): CoachTurnInput {
  return {
    messages: [{ id: 'm1', role: 'user', content }],
    careerContext: { roles: [], locations: [], salaryFloorRubles: floor, formats: [], relocation: false },
  } as unknown as CoachTurnInput;
}

function result(proposals: CoachTurnResult['actionProposals'] = []): CoachTurnResult {
  return {
    message: 'Ориентир уточнён. Нижняя граница поиска — 800 000 ₽ на руки.',
    actionProposals: proposals,
  } as unknown as CoachTurnResult;
}

describe('requestedSalaryFloor (28.10)', () => {
  it('читает порог из просьбы кандидата', () => {
    expect(requestedSalaryFloor(ask)).toBe(800_000);
    expect(requestedSalaryFloor('Зарплата от 450 тыс. рублей, не меньше')).toBe(450_000);
  });

  it('без зарплаты или без суммы порога нет', () => {
    expect(requestedSalaryFloor('Убери роль CTO')).toBeUndefined();
    expect(requestedSalaryFloor('Какая зарплата у CTO?')).toBeUndefined();
  });
});

describe('withSalaryFloorProposal: консультант не меняет условие на словах (28.10)', () => {
  it('добавляет подтверждаемое изменение порога, если модель его не предложила', () => {
    const next = withSalaryFloorProposal(result(), input(ask), new Date('2026-10-28T00:00:00Z'));

    expect(next.actionProposals).toEqual([
      expect.objectContaining({
        kind: 'career.conditions.update',
        risk: 'candidate_data_write',
        careerChange: expect.objectContaining({ salaryFloorRubles: 800_000, roleTitle: null }),
      }),
    ]);
  });

  it('не дублирует изменение, которое модель уже предложила', () => {
    const own = {
      kind: 'career.conditions.update',
      careerChange: { salaryFloorRubles: 800_000 },
    } as unknown as CoachTurnResult['actionProposals'][number];

    expect(withSalaryFloorProposal(result([own]), input(ask)).actionProposals).toEqual([own]);
  });

  it('не предлагает порог, который уже стоит в условиях', () => {
    expect(withSalaryFloorProposal(result(), input(ask, 800_000)).actionProposals).toEqual([]);
  });

  it('без контекста «Карьеры» ничего не трогает', () => {
    const plain = { ...input(ask), careerContext: undefined } as CoachTurnInput;
    expect(withSalaryFloorProposal(result(), plain).actionProposals).toEqual([]);
  });
});
