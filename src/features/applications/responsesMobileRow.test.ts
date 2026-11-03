import { describe, expect, it } from 'vitest';
import type { ApplicationView } from './applicationsApi';
import { mobileDueDate, mobileNextStep, mobileStatusLabel, shortDate } from './responsesMobileRow';

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
    vacancy: { title: 'Head of Platform', company: 'Вектор Банк', url: 'https://x', source: 'hh' },
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

const NOW = new Date('2026-10-08T09:00:00.000Z');

describe('shortDate', () => {
  it('drops the year', () => {
    expect(shortDate('2026-10-06T10:00:00.000Z')).toBe('06.10');
    expect(shortDate(null)).toBe('');
    expect(shortDate('nope')).toBe('');
  });
});

describe('mobileStatusLabel', () => {
  it('dates delivered and responded rows without a year', () => {
    expect(
      mobileStatusLabel(
        application({
          deliveryReceipt: { kind: 'auto_reply', value: 'ok' },
          deliveryReceiptRecordedAt: '2026-10-03T10:00:00.000Z',
        }),
      ),
    ).toBe('Доставлено 03.10');
    expect(mobileStatusLabel(application({ stage: 'responded' }))).toBe('Ответ 06.10');
    expect(mobileStatusLabel(application({ stage: 'offer' }))).toBe('Оффер 06.10');
  });

  it('keeps undated honest states', () => {
    expect(mobileStatusLabel(application({}))).toBe('Пробовали отправить');
    expect(mobileStatusLabel(application({ stage: 'saved' }))).toBe('Черновик');
    expect(
      mobileStatusLabel(application({ deliveryReceipt: { kind: 'failure_note', value: 'x' } })),
    ).toBe('Не доставлено');
  });
});

describe('mobileDueDate', () => {
  it('shows the interview slot first', () => {
    const due = mobileDueDate(
      application({
        stage: 'interview',
        nearestInterview: {
          id: 'i1',
          scheduledAt: '2026-10-10T11:00:00.000Z',
          prepStatus: 'none',
          round: 1,
        } as ApplicationView['nearestInterview'],
      }),
      NOW,
    );
    expect(due?.label).toBe('10.10');
  });

  it('reads a due or overdue reminder as today', () => {
    const followUp = (dueAt: string) =>
      ({
        dueAt,
        urgency: 'due',
        source: 'standard_schedule',
        daysSinceContact: 6,
      }) as ApplicationView['followUp'];
    expect(
      mobileDueDate(application({ followUp: followUp('2026-10-01T09:00:00.000Z') }), NOW)?.label,
    ).toBe('сегодня');
    expect(
      mobileDueDate(application({ followUp: followUp('2026-10-15T09:00:00.000Z') }), NOW)?.label,
    ).toBe('15.10');
  });

  it('shows nothing without a dated step', () => {
    expect(mobileDueDate(application({}), NOW)).toBeNull();
  });
});

describe('mobileNextStep', () => {
  const overdue = {
    dueAt: '2026-10-02T09:00:00.000Z',
    urgency: 'overdue',
    source: 'standard_schedule',
    daysSinceContact: 9,
  } as ApplicationView['followUp'];

  it('retries a failed delivery instead of reminding the recruiter', () => {
    expect(
      mobileNextStep(
        application({
          whoseTurn: 'candidate',
          followUp: overdue,
          deliveryReceipt: { kind: 'failure_note', value: 'hh.ru 500' },
        }),
      ),
    ).toEqual({ label: 'Повторить отклик', hot: true });
    expect(
      mobileNextStep(application({ deliveryReceipt: { kind: 'failure_note', value: 'x' } })),
    ).toEqual({ label: 'Повторить отклик', hot: true });
  });

  it('retries an unconfirmed attempt once a reminder would be due', () => {
    expect(mobileNextStep(application({ whoseTurn: 'candidate', followUp: overdue }))).toEqual({
      label: 'Повторить отклик',
      hot: true,
    });
  });

  it('reminds the recruiter only after a confirmed delivery', () => {
    expect(
      mobileNextStep(
        application({
          whoseTurn: 'candidate',
          followUp: overdue,
          deliveryReceipt: { kind: 'auto_reply', value: 'ok' },
        }),
      ),
    ).toEqual({ label: 'Напомнить рекрутеру', hot: true });
  });

  it('keeps passive steps quiet', () => {
    expect(mobileNextStep(application({}))).toEqual({ label: 'Ждать ответа', hot: false });
    expect(
      mobileNextStep(application({ stage: 'rejected', whoseTurn: null, closedReason: null })).hot,
    ).toBe(false);
  });

  it('marks the candidate move as an action', () => {
    expect(mobileNextStep(application({ stage: 'offer', whoseTurn: 'candidate' }))).toEqual({
      label: 'Решить по офферу',
      hot: true,
    });
  });
});
