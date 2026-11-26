import { describe, expect, it } from 'vitest';
import { goalChosenTip, goalCopy, GOAL_OPTIONS, stepTag, wageTip } from './growthModel';

describe('growthModel', () => {
  it('names the four goals in the order of the screen', () => {
    expect(GOAL_OPTIONS.map(([, label]) => label)).toEqual([
      'Повышение в должности',
      'Прибавка в той же роли',
      'Другая роль внутри компании',
      'Пока остаюсь как есть',
    ]);
  });

  it('builds title, action and side heading by goal', () => {
    expect(goalCopy('promotion', 'Вектор Банк')).toEqual({
      title: 'Повышение в компании «Вектор Банк»',
      action: 'Подготовить разговор о повышении',
      side: 'Аргументы к разговору о повышении',
    });
    expect(goalCopy('stay', 'Вектор Банк')).toEqual({
      title: 'Остаюсь в компании «Вектор Банк»',
      action: null,
      side: 'Ваши результаты за год',
    });
  });

  it('dates the goal and the wage sample', () => {
    expect(goalChosenTip('2026-01-12T09:00:00.000Z')).toBe('Цель выбрана 12 января.');
    expect(wageTip(31, '2026-11-10T00:00:00.000Z')).toBe(
      'hh.ru, 31 вакансия с указанной зарплатой, на 10.11.',
    );
    expect(wageTip(5, '2026-11-10T00:00:00.000Z')).toBe(
      'hh.ru, 5 вакансий с указанной зарплатой, на 10.11.',
    );
  });

  it('maps step state to the tag', () => {
    expect(stepTag('done')).toEqual({ cls: 'step done', tag: 'ok', text: 'есть' });
    expect(stepTag('now')).toEqual({ cls: 'step now', tag: 'part', text: 'в работе' });
    expect(stepTag('next')).toEqual({ cls: 'step', tag: 'miss', text: 'дальше' });
  });
});
