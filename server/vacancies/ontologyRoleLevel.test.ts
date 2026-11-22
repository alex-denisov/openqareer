import { describe, expect, it } from 'vitest';
import { ontologyRoleLevel } from './ontologyRoleLevel';

describe('ontologyRoleLevel (B741)', () => {
  it('уровень профессии берётся из онтологии роли, а не из кампании', () => {
    expect(ontologyRoleLevel('Продакт-менеджер')).toBe('ic');
    expect(ontologyRoleLevel('Product Manager')).toBe('ic');
    expect(ontologyRoleLevel(' product manager ')).toBe('ic');
    expect(ontologyRoleLevel('Head of Product')).toBe('head');
    expect(ontologyRoleLevel('COO')).toBe('c-level');
  });

  it('у роли с несколькими уровнями — нижний', () => {
    expect(ontologyRoleLevel('Project Manager')).toBe('ic');
  });

  it('неизвестное название — уровня нет', () => {
    expect(ontologyRoleLevel('Укротитель драконов')).toBeUndefined();
    expect(ontologyRoleLevel('')).toBeUndefined();
  });
});
