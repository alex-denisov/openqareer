import { beforeEach, describe, expect, it } from 'vitest';
import type { ReasonedCareerAction } from '../next-action/careerActionPolicy';
import {
  clearConsultantActionResolution,
  deferConsultantActionUntilTomorrow,
  todayActionId,
  isConsultantActionResolved,
  resolveConsultantAction,
} from './consultantActionStorage';

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

describe('consultantActionStorage (C57)', () => {
  beforeEach(() => {
    clearConsultantActionResolution('candidate-test-1', mockAction);
    clearConsultantActionResolution('candidate-test-2', mockAction);
  });

  it('uses a stable action identity based on provenance IDs, not copy', () => {
    const id = todayActionId(mockAction);
    expect(id).toMatch(/^[a-f0-9]{16}$/u);
    expect(todayActionId({ ...mockAction, rationale: 'Обновлённое объяснение.' })).toBe(id);
    expect(todayActionId({ ...mockAction, roleIds: [...mockAction.roleIds].reverse() })).toBe(id);
    expect(todayActionId({ ...mockAction, findingIds: ['different-finding'] })).not.toBe(id);
  });

  it('reports action as not resolved initially', () => {
    expect(isConsultantActionResolved('candidate-test-1', mockAction)).toBe(false);
  });

  it('marks action as resolved when accepted', () => {
    resolveConsultantAction('candidate-test-1', mockAction, 'accepted');
    expect(isConsultantActionResolved('candidate-test-1', mockAction)).toBe(true);
    // Different candidate is unaffected
    expect(isConsultantActionResolved('candidate-test-2', mockAction)).toBe(false);
  });

  it('marks action as resolved when dismissed', () => {
    resolveConsultantAction('candidate-test-1', mockAction, 'dismissed');
    expect(isConsultantActionResolved('candidate-test-1', mockAction)).toBe(true);
  });

  it('keeps a postponed action hidden until the next local day, then shows it again', () => {
    const now = new Date(2026, 9, 12, 10, 0, 0, 0);
    const tomorrow = new Date(now);
    tomorrow.setHours(24, 0, 0, 0);
    deferConsultantActionUntilTomorrow('candidate-test-1', mockAction, undefined, now);

    expect(
      isConsultantActionResolved(
        'candidate-test-1',
        mockAction,
        undefined,
        new Date(tomorrow.getTime() - 1),
      ),
    ).toBe(true);
    expect(isConsultantActionResolved('candidate-test-1', mockAction, undefined, tomorrow)).toBe(
      false,
    );
  });

  it('clears resolution', () => {
    resolveConsultantAction('candidate-test-1', mockAction, 'accepted');
    expect(isConsultantActionResolved('candidate-test-1', mockAction)).toBe(true);
    clearConsultantActionResolution('candidate-test-1', mockAction);
    expect(isConsultantActionResolved('candidate-test-1', mockAction)).toBe(false);
  });
});
