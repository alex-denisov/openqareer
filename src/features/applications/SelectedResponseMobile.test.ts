import { describe, expect, it } from 'vitest';
import type { ApplicationView } from './applicationsApi';
import { daysLeft, responseSubline, stepDeadline } from './SelectedResponseMobile';

function application(overrides: Partial<ApplicationView>): ApplicationView {
  return {
    id: 'a1',
    candidateId: 'c1',
    clusterId: 'cl1',
    stage: 'applied',
    closedReason: null,
    archiveReason: null,
    archivePreviousStage: null,
    processProfile: 'standard',
    vacancy: { title: 'VP Engineering', company: 'Арка Холдинг', url: 'https://x', source: 'hh' },
    notes: null,
    followUpDueAt: null,
    stageChangedAt: '2026-10-06T10:00:00.000Z',
    version: 1,
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-06T10:00:00.000Z',
    followUp: null,
    whoseTurn: 'company',
    materials: { coverLetter: true, resume: true },
    nearestInterview: null,
    archiveStaleDays: 30,
    ...overrides,
  };
}

const interview = {
  id: 'i1',
  scheduledAt: '2026-10-10T14:00:00',
  prepStatus: 'none',
  round: 1,
} as ApplicationView['nearestInterview'];

describe('responseSubline', () => {
  it('reads role · channel · interview like mockup 5 `proc`', () => {
    expect(responseSubline(application({ stage: 'interview', nearestInterview: interview }))).toBe(
      'VP Engineering · hh.ru · интервью 10.10, 14:00',
    );
  });

  it('leaves out what is missing', () => {
    expect(responseSubline(application({}))).toBe('VP Engineering · hh.ru');
    expect(responseSubline(application({ vacancy: undefined }))).toBe('');
  });
});

describe('stepDeadline', () => {
  it('counts an interview step to the interview, other steps to the reminder', () => {
    expect(stepDeadline(application({ stage: 'interview', nearestInterview: interview }))).toBe(
      '2026-10-10T14:00:00',
    );
    expect(stepDeadline(application({ followUpDueAt: '2026-10-12T00:00:00.000Z' }))).toBe(
      '2026-10-12T00:00:00.000Z',
    );
  });
});

describe('daysLeft', () => {
  const now = new Date('2026-10-07T12:00:00').getTime();
  it('says how many days are left, today or overdue', () => {
    expect(daysLeft('2026-10-10T12:00:00', now)).toBe('Осталось 3 дня');
    expect(daysLeft('2026-10-07T12:00:00', now)).toBe('Срок сегодня');
    expect(daysLeft('2026-10-01T12:00:00', now)).toBe('Срок прошёл');
    expect(daysLeft(null, now)).toBeNull();
    expect(daysLeft('nope', now)).toBeNull();
  });
});
