import { describe, expect, it } from 'vitest';
import { skillLineText } from './SkillLine';

describe('строка «Проверить N навыков»', () => {
  it('склоняет навык', () => {
    expect(skillLineText(1)).toBe('Проверить 1 навык');
    expect(skillLineText(3)).toBe('Проверить 3 навыка');
    expect(skillLineText(5)).toBe('Проверить 5 навыков');
  });

  it('B645: 2–4 — «навыка», 11–14 — «навыков», 21 — «навык», 22 — «навыка»', () => {
    expect(skillLineText(2)).toBe('Проверить 2 навыка');
    expect(skillLineText(4)).toBe('Проверить 4 навыка');
    for (const n of [11, 12, 14, 25]) expect(skillLineText(n)).toBe(`Проверить ${n} навыков`);
    expect(skillLineText(21)).toBe('Проверить 21 навык');
    expect(skillLineText(22)).toBe('Проверить 22 навыка');
  });
});
