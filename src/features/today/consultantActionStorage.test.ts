import { describe, expect, it } from 'vitest';
import type { ReasonedCareerAction } from '../next-action/careerActionPolicy';
import { todayActionId } from './consultantActionStorage';

const mockAction: ReasonedCareerAction = {
  revision: 'career-action-policy-v1-2026-08-07',
  type: 'review',
  destination: 'profile',
  headline: 'Добавим полный источник',
  label: 'Дополнить профиль',
  rationale: 'Сначала закрываем «материала недостаточно для полного разбора».',
  expectedChange: 'Полный источник откроет недостающие даты, задачи и результаты.',
  findingIds: ['readability-short'],
  roleIds: ['role-target'],
  marketIds: ['eu', 'mena'],
  alternatives: [],
  approvalBoundary: 'Профиль меняется только после согласования.',
};

describe('todayActionId (C3)', () => {
  it('uses a stable action identity based on provenance IDs, not copy', () => {
    const id = todayActionId(mockAction);
    expect(id).toMatch(/^[a-f0-9]{16}$/u);
    expect(todayActionId({ ...mockAction, rationale: 'Обновлённое объяснение.' })).toBe(id);
    expect(todayActionId({ ...mockAction, headline: 'Другой заголовок' })).toBe(id);
    expect(todayActionId({ ...mockAction, roleIds: [...mockAction.roleIds].reverse() })).toBe(id);
    expect(todayActionId({ ...mockAction, findingIds: ['different-finding'] })).not.toBe(id);
  });
});
