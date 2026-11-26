import { describe, expect, it } from 'vitest';
import { reminderDraft, reminderLanguage } from './reminderDraft';
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

  it('к англоязычной вакансии напоминание на английском', () => {
    const english = application({
      appliedAt: '2026-11-04T10:00:00.000Z',
      vacancy: { title: 'Senior Solutions Engineer', company: 'Snowflake', url: '', source: 'ats-ashby-snowflake' },
    });
    const text = reminderDraft(english, new Date('2026-11-12T09:00:00.000Z'));
    expect(text).toBe(
      'Hello,\n\nI applied for the Senior Solutions Engineer role at Snowflake on November 4. Could you please confirm that my application was received and let me know when I can expect a reply?\n\nThank you!',
    );
    expect(text).not.toMatch(/[а-яё]/iu);
    const after = reminderDraft(
      { ...english, interviewScheduledAt: ['2026-11-10T12:00:00.000Z'] },
      new Date('2026-11-12T09:00:00.000Z'),
    );
    expect(after).toContain('following up on our interview for the Senior Solutions Engineer role at Snowflake');
  });

  it('название с кириллицей или без букв оставляет русский текст', () => {
    expect(reminderLanguage(application())).toBe('ru');
    expect(
      reminderLanguage(application({ vacancy: { title: 'Head of Engineering (Москва)', company: '', url: '', source: 'hh' } })),
    ).toBe('ru');
    expect(reminderLanguage(application({ vacancy: { title: '', company: '', url: '', source: 'hh' } }))).toBe('ru');
    expect(
      reminderLanguage(application({ vacancy: { title: 'Head of Engineering', company: 'Гринкод', url: '', source: 'linkedin' } })),
    ).toBe('ru');
    expect(
      reminderLanguage(application({ vacancy: { title: 'Head of Engineering', company: 'Acme', url: '', source: 'hh' } })),
    ).toBe('ru');
    expect(
      reminderLanguage(application({ vacancy: { title: 'Head of Engineering', company: 'Acme', url: '', source: 'linkedin' } })),
    ).toBe('en');
  });
});
