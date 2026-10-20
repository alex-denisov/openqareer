import { describe, expect, it } from 'vitest';
import { teamSizeRequirement } from './teamSizeRequirement';

describe('teamSizeRequirement (B540)', () => {
  it('reads the smallest team a vacancy asks to lead', () => {
    expect(teamSizeRequirement('Опыт управления командой от 50 человек.')).toBe(50);
    expect(teamSizeRequirement('Руководство командами от 30 инженеров')).toBe(30);
    expect(teamSizeRequirement('Управление командой из 40+ разработчиков')).toBe(40);
    expect(teamSizeRequirement('Experience leading teams of 50+ engineers')).toBe(50);
    expect(teamSizeRequirement('Managed an organisation of 120 people')).toBe(120);
  });

  it('ignores numbers that are not a team size', () => {
    expect(teamSizeRequirement('Опыт от 5 лет, зарплата от 500 000')).toBeNull();
    expect(teamSizeRequirement('Команда 2 человека? нет')).toBeNull();
    expect(teamSizeRequirement('')).toBeNull();
  });
});
