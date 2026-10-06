import { describe, expect, it } from 'vitest';
import type { ApplicationView } from './applicationsApi';
import {
  actionFailureLabel,
  actionStatusLabel,
  formatActionCount,
  getActionLimitMessage,
  getSelectableActionApplications,
} from './candidateActionModel';

function application(overrides: Partial<ApplicationView> = {}): ApplicationView {
  return {
    id: 'app-1',
    candidateId: 'candidate-1',
    clusterId: 'cluster-1',
    stage: 'saved',
    closedReason: null,
    archiveReason: null,
    archivePreviousStage: null,
    processProfile: 'standard',
    vacancy: { title: 'Инженер', company: 'Компания', url: 'https://hh.ru/vacancy/123', source: 'hh' },
    notes: null,
    followUpDueAt: null,
    stageChangedAt: '2026-10-01T10:00:00.000Z',
    version: 1,
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-01T10:00:00.000Z',
    followUp: null,
    whoseTurn: 'candidate',
    materials: { coverLetter: false, resume: false },
    nearestInterview: null,
    ...overrides,
  };
}

describe('candidateActionModel', () => {
  it('selects only saved vacancies on the two supported platforms', () => {
    const result = getSelectableActionApplications([
      application(),
      application({ id: 'linkedin-1', vacancy: { title: 'Engineer', company: 'Other', url: 'https://www.linkedin.com/jobs/view/42', source: 'linkedin' } }),
      application({ id: 'applied-1', stage: 'applied' }),
      application({ id: 'unsafe-1', vacancy: { title: 'Other', company: 'Company', url: 'https://evil.example/job/1', source: 'other' } }),
    ]);

    expect(result.map((item) => [item.application.id, item.platform, item.actionKind])).toEqual([
      ['app-1', 'hh', 'hh_apply'],
      ['linkedin-1', 'linkedin', 'linkedin_easy_apply'],
    ]);
  });

  it('names a limit or quiet-hours block before the package can be sent', () => {
    const usage = {
      localDate: '2026-10-01',
      hhAppliesCount: 15,
      linkedinEasyAppliesCount: 0,
      hhBoostsCount: 0,
      lastHhBoostAt: null,
    };
    expect(getActionLimitMessage({
      actions: [{ actionKind: 'hh_apply' }],
      usage,
      timezone: 'Europe/Moscow',
      now: new Date('2026-10-01T12:00:00Z'),
      resetAt: '2026-10-01T21:00:00Z',
    })).toContain('Сброс:');
    expect(getActionLimitMessage({
      actions: [{ actionKind: 'hh_apply' }],
      usage: { ...usage, hhAppliesCount: 0 },
      timezone: 'Europe/Moscow',
      now: new Date('2026-10-01T01:00:00Z'),
      resetAt: '2026-10-01T21:00:00Z',
    })).toContain('тихих часов');
  });

  it('uses words as well as status styling to identify receipt outcomes', () => {
    expect(actionStatusLabel('delivered')).toBe('Доставлено');
    expect(actionStatusLabel('attempted')).toBe('Не подтверждено');
    expect(actionFailureLabel('challenge_required')).toContain('вручную');
    expect(formatActionCount(1)).toBe('1 действие');
    expect(formatActionCount(3)).toBe('3 действия');
    expect(formatActionCount(12)).toBe('12 действий');
  });
});
