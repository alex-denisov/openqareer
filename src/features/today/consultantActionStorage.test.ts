import { beforeEach, describe, expect, it } from 'vitest';
import type { ReasonedCareerAction } from '../next-action/careerActionPolicy';
import {
  clearConsultantActionResolution,
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

  it('clears resolution', () => {
    resolveConsultantAction('candidate-test-1', mockAction, 'accepted');
    expect(isConsultantActionResolved('candidate-test-1', mockAction)).toBe(true);
    clearConsultantActionResolution('candidate-test-1', mockAction);
    expect(isConsultantActionResolved('candidate-test-1', mockAction)).toBe(false);
  });
});
