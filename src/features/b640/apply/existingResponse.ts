import type { ApplicationView } from '../../applications/applicationsApi';
import { buildNodePath } from '../routes';
import { appliedOn } from '../vacancies/vacancyLinks';
import { forgetApply } from './applyIntent';

/** Отклик по этой вакансии уже отправлен, а адрес несёт саму вакансию: новое письмо не нужно. */
export function existingResponseId(
  responseId: string,
  applications: readonly ApplicationView[],
): string | null {
  if (applications.some((application) => application.id === responseId)) return null;
  const sent = applications.find((application) => application.clusterId === responseId);
  return sent && appliedOn(sent) ? sent.id : null;
}

/**
 * B801: «Откликнуться» у вакансии с отправленным откликом открывает этот отклик. Запись истории
 * заменяется: «Назад» сюда не возвращает. Экран письма до ухода остаётся в ожидании.
 */
export async function openExistingFirst(
  responseId: string,
  applications: readonly ApplicationView[],
  signal: AbortSignal,
): Promise<readonly ApplicationView[]> {
  const existing = existingResponseId(responseId, applications);
  if (!existing || signal.aborted) return applications;
  forgetApply(responseId);
  window.history.replaceState(null, '', buildNodePath('o01c', { responseId: existing }));
  window.dispatchEvent(new PopStateEvent('popstate'));
  return new Promise(() => undefined);
}
