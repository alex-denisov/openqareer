import { expect, it } from 'vitest';
import { DEFAULT_VACANCY_MECHANICS_LANES, vacancyMechanicsLanes } from './vacancyMechanicsLanes';

it('runs twelve lanes by default and takes an explicit count from 1 to 16', () => {
  expect(vacancyMechanicsLanes({})).toBe(DEFAULT_VACANCY_MECHANICS_LANES);
  expect(DEFAULT_VACANCY_MECHANICS_LANES).toBe(12);
  expect(vacancyMechanicsLanes({ OPENQAREER_VACANCY_MECHANICS_LANES: '8' })).toBe(8);
});

it('refuses a count outside the range instead of guessing', () => {
  for (const value of ['0', '17', '2.5', 'many'])
    expect(() => vacancyMechanicsLanes({ OPENQAREER_VACANCY_MECHANICS_LANES: value })).toThrow(
      '1 to 16',
    );
});
