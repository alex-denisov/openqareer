import { describe, expect, it } from 'vitest';
import { roleNamingInstructions } from './roleNaming';

describe('инструкция называния ролей', () => {
  it('называет язык прямо, а не оставляет его на усмотрение модели', () => {
    expect(roleNamingInstructions('en')).toContain('английск');
    expect(roleNamingInstructions('ru')).toContain('русск');
  });

  it('запрещает переводить название, которого на русском рынке нет', () => {
    // Правило владельца: DevOps в РФ чаще всего не переводится, а «Инженер
    // доступности» — это уже другая роль, а не перевод (B180, 2026-09-03).
    expect(roleNamingInstructions('ru')).toContain('не переводи');
  });

  it('английская инструкция не просит русских названий', () => {
    expect(roleNamingInstructions('en')).not.toContain('по-русски');
  });
});
