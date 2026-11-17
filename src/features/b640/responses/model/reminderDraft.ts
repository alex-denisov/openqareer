import type { ApplicationView } from '../../../applications/applicationsApi';
import { generateCompanyReminderDraft } from '../../../applications/companyReminderDraft';
import { longDate } from './responseRow';

/**
 * Текст напоминания компании. Опирается только на то, что было по отклику: о собеседовании
 * говорит, если оно назначалось; иначе напоминает об отправленном отклике.
 */
export function reminderDraft(application: ApplicationView): string {
  const title = application.vacancy?.title?.trim() ?? '';
  const company = application.vacancy?.companyHidden ? '' : (application.vacancy?.company?.trim() ?? '');
  const interviewed =
    application.stage === 'interview' || (application.interviewScheduledAt ?? []).length > 0;
  if (interviewed) return generateCompanyReminderDraft({ company, positionTitle: title });
  const role = title ? `на вакансию «${title}»` : 'на вашу вакансию';
  const where = company ? ` в компании ${company}` : '';
  const sent = longDate(application.appliedAt);
  return [
    'Здравствуйте!',
    `Мой отклик ${role}${where} отправлен${sent ? ` ${sent}` : ''}. Подскажите, пожалуйста, получили ли вы его и когда можно ждать ответа.`,
    'Спасибо!',
  ].join('\n\n');
}
