import { describe, expect, it } from 'vitest';
import { reminderDraft } from './reminderDraft';
import { application } from './testApplication';

describe('текст напоминания компании', () => {
  it('без интервью говорит об отклике, а не о собеседовании', () => {
    const text = reminderDraft(application({ appliedAt: '2026-11-04T10:00:00.000Z' }));
    expect(text).toContain('Мой отклик на вакансию «Руководитель платформы» в компании Арка Холдинг отправлен 4 ноября');
    expect(text).not.toMatch(/собеседован/u);
  });

  it('после прошедшего интервью спрашивает о его итогах', () => {
    const text = reminderDraft(
      application({ stage: 'responded', interviewScheduledAt: ['2026-11-11T12:00:00.000Z'] }),
      new Date('2026-11-12T09:00:00.000Z'),
    );
    expect(text).toMatch(/собеседования/u);
  });

  it('интервью, которое ещё впереди, собеседованием не считается', () => {
    const text = reminderDraft(
      application({ stage: 'interview', interviewScheduledAt: ['2026-11-20T12:00:00.000Z'] }),
      new Date('2026-11-12T09:00:00.000Z'),
    );
    expect(text).not.toMatch(/собеседован/u);
  });

  it('скрытая компания и пустое название не подставляются', () => {
    const text = reminderDraft(
      application({ appliedAt: null, vacancy: { title: '', company: 'Тайна', url: '', source: 'manual', companyHidden: true } }),
    );
    expect(text).toContain('Мой отклик на вашу вакансию отправлен. ');
    expect(text).not.toContain('Тайна');
  });
});
