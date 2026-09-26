import { describe, expect, it } from 'vitest';
import { waitingLabel, type WaitingLabelInput } from './waitingLabel';

const base: WaitingLabelInput = {
  stage: 'applied',
  whoseTurn: 'company',
  hasMaterials: true,
  followUp: null,
  nearestInterviewNeedsPrep: false,
  closedReason: null,
};

describe('waitingLabel', () => {
  it('asks the candidate to collect a cover letter for a bare "saved" card', () => {
    expect(
      waitingLabel({ ...base, stage: 'saved', whoseTurn: 'candidate', hasMaterials: false }),
    ).toEqual({ text: 'Соберите письмо', on: 'you' });
  });

  it('names an overdue follow-up as stale', () => {
    expect(
      waitingLabel({
        ...base,
        whoseTurn: 'candidate',
        followUp: { dueAt: '2026-09-01', urgency: 'stale', source: 'standard_schedule', daysSinceContact: 12 },
      }).text,
    ).toBe('Follow-up просрочен');
  });

  it('shows calendar days once a follow-up is due', () => {
    expect(
      waitingLabel({
        ...base,
        whoseTurn: 'candidate',
        followUp: { dueAt: '2026-09-01', urgency: 'due', source: 'standard_schedule', daysSinceContact: 6 },
      }).text,
    ).toBe('Follow-up сегодня · 6 дней');
  });

  it('asks for interview prep ahead of the follow-up formula', () => {
    expect(
      waitingLabel({ ...base, whoseTurn: 'candidate', nearestInterviewNeedsPrep: true }).text,
    ).toBe('Подготовиться к интервью');
  });

  it('asks for an offer decision', () => {
    expect(waitingLabel({ ...base, stage: 'offer', whoseTurn: 'candidate' }).text).toBe(
      'Примите решение по офферу',
    );
  });

  it('says it is early for a follow-up while the company is still expected to answer', () => {
    expect(
      waitingLabel({
        ...base,
        followUp: { dueAt: '2026-09-10', urgency: 'upcoming', source: 'standard_schedule', daysSinceContact: 1 },
      }),
    ).toEqual({ text: 'Отправлен · рано для follow-up', on: 'them' });
  });

  it('defaults to waiting for the company otherwise', () => {
    expect(waitingLabel(base)).toEqual({ text: 'Ждём ответа компании', on: 'them' });
  });

  it('names the skip reason for a rejected card and falls back when unknown', () => {
    expect(
      waitingLabel({ ...base, whoseTurn: null, stage: 'rejected', closedReason: 'level' }).text,
    ).toBe('Отказ · не тот уровень (слишком junior / слишком старший)');
    expect(
      waitingLabel({ ...base, whoseTurn: null, stage: 'rejected', closedReason: null }).text,
    ).toBe('Отказ · причина не указана');
  });

  it('names an archived card closed on the site', () => {
    expect(
      waitingLabel({ ...base, whoseTurn: null, stage: 'archived', closedReason: 'company_declined' }).text,
    ).toBe('Архив · отказ компании');
  });
});
