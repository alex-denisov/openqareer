import { describe, expect, it } from 'vitest';
import { responseNextStep, responseStatusPill } from './responseCardFace';

const base = {
  stage: 'applied' as const,
  stageChangedAt: '2026-10-06T10:00:00',
  appliedAt: '2026-10-02T10:00:00',
  whoseTurn: 'company' as const,
  materials: { coverLetter: true, resume: true },
  followUp: null,
  followUpDueAt: null,
  nearestInterview: null,
  deliveryReceipt: null,
  deliveryReceiptRecordedAt: null,
  closedReason: null,
};

describe('responseStatusPill', () => {
  it('shows one dated pill per stage', () => {
    expect(responseStatusPill(base)).toEqual({ tone: 'sent', label: 'Отправлено 02.10' });
    expect(
      responseStatusPill({
        ...base,
        deliveryReceipt: { kind: 'auto_reply', value: 'ok' },
        deliveryReceiptRecordedAt: '2026-10-03T09:00:00',
      }),
    ).toEqual({ tone: 'ok', label: 'Доставлено 03.10' });
    expect(
      responseStatusPill({
        ...base,
        deliveryReceipt: { kind: 'failure_note', value: 'резюме скрыто' },
      }),
    ).toEqual({ tone: 'fail', label: 'Не доставлено: резюме скрыто' });
    expect(responseStatusPill({ ...base, stage: 'responded' }).label).toBe('Ответ 06.10');
    expect(responseStatusPill({ ...base, stage: 'offer' }).label).toBe('Оффер 06.10');
    expect(
      responseStatusPill({
        ...base,
        stage: 'interview',
        nearestInterview: { id: 'i', scheduledAt: '2026-10-10T14:00:00', prepStatus: 'none' },
      } as never).label,
    ).toBe('Интервью 10.10, 14:00');
  });
});

describe('responseNextStep', () => {
  it('names the action, the addressee and the date from the record', () => {
    expect(
      responseNextStep({
        ...base,
        followUp: {
          dueAt: '2026-10-14T00:00:00',
          urgency: 'upcoming',
          source: 'policy',
          daysSinceContact: 1,
        },
      } as never),
    ).toEqual({ text: 'Ждать ответа до 14.10', yours: false });
    const dueReminder = {
      dueAt: '2026-10-08T00:00:00',
      urgency: 'due',
      source: 'policy',
      daysSinceContact: 5,
    };
    expect(
      responseNextStep({
        ...base,
        whoseTurn: 'candidate',
        deliveryReceipt: { kind: 'auto_reply', value: 'ok' },
        followUp: dueReminder,
      } as never).text,
    ).toBe('Напомнить компании сегодня');
    // An unconfirmed send is resent, not followed up (B511 G3 item 5).
    expect(
      responseNextStep({ ...base, whoseTurn: 'candidate', followUp: dueReminder } as never).text,
    ).toBe('Повторить отклик');
    expect(
      responseNextStep({
        ...base,
        stage: 'offer',
        whoseTurn: 'candidate',
        followUpDueAt: '2026-10-14T00:00:00',
      }).text,
    ).toBe('Ответить до 14.10');
    expect(
      responseNextStep({
        ...base,
        deliveryReceipt: { kind: 'failure_note', value: 'x' },
        whoseTurn: 'candidate',
      }).text,
    ).toBe('Повторить отклик');
    expect(responseNextStep({ ...base, stage: 'saved', whoseTurn: 'candidate' }).text).toBe(
      'Одобрить письмо',
    );
  });

  it('never says the letter is missing on a sent response', () => {
    const text = responseNextStep({
      ...base,
      materials: { coverLetter: false, resume: false },
    }).text;
    expect(text).not.toContain('Письмо не собрано');
  });
});
