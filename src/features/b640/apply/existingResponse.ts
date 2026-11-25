import { useEffect } from 'react';
import { ALREADY_APPLIED_EVENT } from '../../coach/apiClient';
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
  const sent = applications.find(
    (application) => application.clusterId === responseId && appliedOn(application),
  );
  return sent?.id ?? null;
}

function openSent(responseId: string, existing: string): void {
  forgetApply(responseId);
  window.history.replaceState(
    window.history.state,
    '',
    buildNodePath('o01c', { responseId: existing }),
  );
  window.dispatchEvent(new PopStateEvent('popstate'));
}

/** Дубль узнал сервер (другой id, то же объявление): открывается отправленный отклик. */
export function useSentElsewhere(responseId: string): void {
  useEffect(() => {
    const open = (event: Event): void => {
      const sentId = (event as CustomEvent<string>).detail;
      if (sentId !== responseId) openSent(responseId, sentId);
    };
    window.addEventListener(ALREADY_APPLIED_EVENT, open);
    return () => window.removeEventListener(ALREADY_APPLIED_EVENT, open);
  }, [responseId]);
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
  openSent(responseId, existing);
  return new Promise(() => undefined);
}
