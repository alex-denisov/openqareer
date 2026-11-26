import { describe, expect, it } from 'vitest';
import { readRoleLevel } from './vacancyRoleContext';

function store(primaryLevel: 'vp' | 'c-level', title = 'VP Operations') {
  return {
    getSnapshot: () => ({ resume: { draft: { experience: [{ title, current: true }] } } }),
    getCandidateWorkspace: () => ({
      campaign: { auto: { roles: [{ title: 'COO', kind: 'primary', level: primaryLevel }] } },
    }),
  } as never;
}

describe('readRoleLevel: уровень выборки одной роли (B741)', () => {
  it('«Продакт-менеджер» при VP-кампании берёт уровень IC из онтологии', () => {
    expect(readRoleLevel(store('vp'), 'c1', 'Продакт-менеджер')).toBe('ic');
  });

  it('слово уровня в названии важнее онтологии', () => {
    expect(readRoleLevel(store('vp'), 'c1', 'Senior Product Manager')).not.toBe('vp');
    expect(readRoleLevel(store('vp'), 'c1', 'Head of Product')).toBe('head');
  });

  it('роль вне онтологии — прежний порядок: кампания', () => {
    expect(readRoleLevel(store('c-level'), 'c1', 'Укротитель драконов')).toBe('c-level');
  });
});
