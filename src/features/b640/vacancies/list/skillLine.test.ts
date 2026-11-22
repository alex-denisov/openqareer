import { describe, expect, it } from 'vitest';
import { skillLineText } from './SkillLine';

describe('строка «Проверить N навыков»', () => {
  it('склоняет навык', () => {
    expect(skillLineText(1)).toBe('Проверить 1 навык');
    expect(skillLineText(3)).toBe('Проверить 3 навыка');
    expect(skillLineText(5)).toBe('Проверить 5 навыков');
  });
});
