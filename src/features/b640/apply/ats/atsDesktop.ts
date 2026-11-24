import { invokeDesktopCommand } from '../../../../services/desktop/desktopBridge';
import type {
  AtsAttempt,
  AtsEntry,
  AtsFillReport,
  AtsFormReport,
  AtsOption,
  AtsReceipt,
  AtsStepReport,
} from './atsFormTypes';

/** B787: форма работодателя в скрытом окне приложения. Вне приложения каждая команда отвечает `null`. */
export function openAtsForm(
  vacancyId: string,
  url: string,
  board?: string,
): Promise<AtsFormReport | null> {
  return invokeDesktopCommand<AtsFormReport>('ats_form_open', {
    request: { vacancyId, url, board: board ?? null },
  });
}

/** Открытая форма как она есть сейчас: ответ мог добавить на страницу новые вопросы. */
export function readAtsForm(vacancyId: string): Promise<AtsFormReport | null> {
  return invokeDesktopCommand<AtsFormReport>('ats_form_read', { vacancyId });
}

/** Варианты одного списка, суженные введённым текстом. */
export function readAtsOptions(
  vacancyId: string,
  key: string,
  query = '',
): Promise<readonly AtsOption[] | null> {
  return invokeDesktopCommand<readonly AtsOption[]>('ats_form_options', {
    request: { vacancyId, key, query },
  });
}

/** Следующая страница формы: только после «Отправить» кандидата и только с его значениями. */
export function nextAtsStep(
  vacancyId: string,
  values: Readonly<Record<string, string>>,
): Promise<AtsStepReport | null> {
  return invokeDesktopCommand<AtsStepReport>('ats_form_next', {
    request: { vacancyId, confirmed: true, values },
  });
}

export function fillAtsForm(
  vacancyId: string,
  entries: readonly AtsEntry[],
): Promise<AtsFillReport | null> {
  return invokeDesktopCommand<AtsFillReport>('ats_form_fill', { request: { vacancyId, entries } });
}

/**
 * Одно нажатие кнопки отправки: только после «Отправить» кандидата и только для показанных ему
 * значений. Попытка пишется на диск до нажатия. Вызывать через `sendAtsForm`: он ведёт журнал согласий.
 */
export function submitAtsForm(
  vacancyId: string,
  values: Readonly<Record<string, string>>,
  attempt: { readonly id: string; readonly consentIds: readonly string[] },
): Promise<AtsReceipt | null> {
  return invokeDesktopCommand<AtsReceipt>('ats_form_submit', {
    request: {
      vacancyId,
      confirmed: true,
      values,
      attemptId: attempt.id,
      consentIds: attempt.consentIds,
    },
  });
}

export function readAtsOutcome(vacancyId: string): Promise<AtsReceipt | null> {
  return invokeDesktopCommand<AtsReceipt>('ats_form_outcome', { vacancyId });
}

/** Последняя попытка по вакансии, в том числе до перезапуска приложения. */
export function readAtsAttempt(vacancyId: string): Promise<AtsAttempt | null> {
  return invokeDesktopCommand<AtsAttempt | null>('ats_form_attempt', { vacancyId });
}

/** Стирает cookies и файлы форм работодателей, когда кандидат удаляет аккаунт. */
export function eraseAtsForms(): Promise<void | null> {
  return invokeDesktopCommand<void>('ats_form_erase', {});
}

/** Показывает окно формы; вызывать только по нажатию кандидата (проверка, которую проходит он сам). */
export function showAtsForm(vacancyId: string): Promise<boolean | null> {
  return invokeDesktopCommand<boolean>('ats_form_show', { vacancyId });
}

export function closeAtsForm(): Promise<void | null> {
  return invokeDesktopCommand<void>('ats_form_close', {});
}
