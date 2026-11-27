/**
 * B787: отклики, которые кандидат отправляет сам на площадке. Платформа заранее собирает письмо,
 * резюме и ответы; за кандидата в LinkedIn и на сайтах с аккаунтом ничего не делается.
 */
export const MANUAL_APPLY_REASONS = [
  'linkedin',
  'account_required',
  'sign_in_required',
  'captcha',
  'other',
] as const;
export type ManualApplyReason = (typeof MANUAL_APPLY_REASONS)[number];

/** `preparing` — собираем; `ready` — всё готово; `needs_answer` — есть вопросы без ответа. */
export type ManualApplyState = 'preparing' | 'ready' | 'needs_answer';

export interface ManualApplyItem {
  readonly vacancyId: string;
  readonly applicationId: string;
  readonly title: string;
  readonly company: string;
  /** Только https; у площадки другого адреса — `null`. */
  readonly url: string | null;
  readonly reason: ManualApplyReason;
  readonly host: string;
  readonly state: ManualApplyState;
  /** Письмо и резюме ещё собираются; вопросы могут быть уже видны. */
  readonly preparing: boolean;
  /** Обязательные вопросы без ответа кандидата. */
  readonly missingAnswers: number;
  /** Готовое письмо; `null` — ещё собирается или не собралось. */
  readonly letter: string | null;
  readonly createdAt: string;
}

/** Причина словами кандидата. */
export function manualApplyReasonText(reason: ManualApplyReason, host: string): string {
  switch (reason) {
    case 'linkedin':
      return 'Отправить в LinkedIn';
    case 'account_required':
      return `Нужен аккаунт на ${host}`;
    case 'sign_in_required':
      return host === 'hh.ru' ? 'Нужен вход в hh.ru' : `Нужен вход на ${host}`;
    case 'captcha':
      return 'Проверка на сайте';
    default:
      return 'Отправить на сайте';
  }
}

/** Адрес для ссылки «Открыть вакансию»: только https и без логина в адресе. */
export function manualApplyUrl(url: string | null): string | null {
  try {
    const parsed = new URL(url ?? '');
    const safe = parsed.protocol === 'https:' && !parsed.username && !parsed.password;
    return safe ? parsed.href : null;
  } catch {
    return null;
  }
}

/** Хост из адреса вакансии без `www.`; страны hh.ru — одна площадка. */
export function manualApplyHost(url: string): string {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./u, '');
    return /(?:^|\.)hh\.ru$/u.test(host) ? 'hh.ru' : host;
  } catch {
    return '';
  }
}
