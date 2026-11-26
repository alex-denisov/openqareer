import type { ApplicationView } from '../../../applications/applicationsApi';
import { generateCompanyReminderDraft } from '../../../applications/companyReminderDraft';
import { platformOf } from './platform';
import { longDate } from './responseRow';

const EN_MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

/**
 * Язык напоминания — язык вакансии, как у письма. Текста вакансии в отклике нет, поэтому
 * английским считаем отклик без кириллицы в названии и компании и не с hh.ru: на hh.ru
 * вакансии с английским названием обычно написаны по-русски.
 */
export function reminderLanguage(application: ApplicationView): 'ru' | 'en' {
  const vacancy = application.vacancy;
  const text = `${vacancy?.title ?? ''} ${vacancy?.companyHidden ? '' : (vacancy?.company ?? '')}`;
  if (!/[a-z]/iu.test(vacancy?.title ?? '') || /[а-яё]/iu.test(text)) return 'ru';
  return platformOf(vacancy?.source).label === 'hh.ru' ? 'ru' : 'en';
}

function englishDraft(title: string, company: string, sentIso: string | null | undefined, interviewed: boolean): string {
  const role = title ? `the ${title} role` : 'the role';
  const where = company ? ` at ${company}` : '';
  const date = sentIso ? new Date(sentIso) : null;
  const sent = date && !Number.isNaN(date.getTime()) ? ` on ${EN_MONTHS[date.getMonth()]} ${date.getDate()}` : '';
  const body = interviewed
    ? `I am following up on our interview for ${role}${where}. I would be grateful for an update on the next steps.`
    : `I applied for ${role}${where}${sent}. Could you please confirm that my application was received and let me know when I can expect a reply?`;
  return ['Hello,', body, 'Thank you!'].join('\n\n');
}

/**
 * Текст напоминания компании. Опирается только на то, что было по отклику: о собеседовании
 * говорит, если оно уже прошло; иначе напоминает об отправленном отклике.
 */
export function reminderDraft(application: ApplicationView, now: Date = new Date()): string {
  const title = application.vacancy?.title?.trim() ?? '';
  const company = application.vacancy?.companyHidden ? '' : (application.vacancy?.company?.trim() ?? '');
  // Собеседование было, только если его дата уже прошла: назначенное на будущее не считается.
  const interviewed = (application.interviewScheduledAt ?? []).some(
    (at) => new Date(at).getTime() <= now.getTime(),
  );
  if (reminderLanguage(application) === 'en') {
    return englishDraft(title, company, application.appliedAt, interviewed);
  }
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
