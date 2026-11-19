import { describe, expect, it } from 'vitest';
import { LOCAL_TIME_BUDGET_FACTOR, timeBudget, timeBudgetFactor } from './timeBudget';

describe('B718: пороги скорости в тестах', () => {
  it('в CI порог прежний: скорость проверяется как раньше', () => {
    expect(timeBudgetFactor({ CI: 'true' })).toBe(1);
    expect(timeBudget(1_000, { CI: 'true' })).toBe(1_000);
  });

  it('локально порог шире: хост делят несколько сессий', () => {
    expect(LOCAL_TIME_BUDGET_FACTOR).toBe(5);
    expect(timeBudgetFactor({})).toBe(5);
    expect(timeBudgetFactor({ CI: 'false' })).toBe(5);
    expect(timeBudget(1_000, {})).toBe(5_000);
  });

  it('переменная OPENQAREER_TIME_BUDGET_FACTOR задаёт множитель явно, и в CI тоже', () => {
    expect(timeBudgetFactor({ OPENQAREER_TIME_BUDGET_FACTOR: '2' })).toBe(2);
    expect(timeBudgetFactor({ CI: 'true', OPENQAREER_TIME_BUDGET_FACTOR: '3' })).toBe(3);
  });

  it('неверное значение переменной не ослабляет и не ужесточает порог молча', () => {
    expect(timeBudgetFactor({ CI: 'true', OPENQAREER_TIME_BUDGET_FACTOR: 'abc' })).toBe(1);
    expect(timeBudgetFactor({ OPENQAREER_TIME_BUDGET_FACTOR: '0' })).toBe(5);
    expect(timeBudgetFactor({ OPENQAREER_TIME_BUDGET_FACTOR: '-1' })).toBe(5);
  });
});
