import { describe, expect, it } from 'vitest';
import { trainingCase } from './trainingCase';

describe('trainingCase (B635)', () => {
  it.each([
    ['Lead Backend Developer', 'system'],
    ['Lead Data Scientist', 'system'],
    ['Lead Software Engineer', 'system'],
    ['Backend Team Lead', 'system'],
    ['Ведущий разработчик', 'system'],
    ['Lead Accountant', 'work'],
    ['Head of AI', 'leadership'],
    ['Head of Backend Development', 'leadership'],
    ['VP of Engineering', 'leadership'],
    ['CTO', 'leadership'],
    ['Engineering Manager', 'leadership'],
    ['Software Engineering Manager, Platform', 'leadership'],
    ['Технический директор / Ведущий инженер СЭС (СНЭ)', 'leadership'],
  ])('%s → %s', (vacancyTitle, expected) => {
    expect(trainingCase({ vacancyTitle })).toBe(expected);
  });
});
