import { invokeDesktopCommand } from '../../../../services/desktop/desktopBridge';
import type { AtsEntry, AtsFillReport, AtsFormReport, AtsReceipt } from './atsFormTypes';

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

export function fillAtsForm(
  vacancyId: string,
  entries: readonly AtsEntry[],
): Promise<AtsFillReport | null> {
  return invokeDesktopCommand<AtsFillReport>('ats_form_fill', { request: { vacancyId, entries } });
}

/** Одно нажатие кнопки отправки: только после «Отправить» кандидата и только для показанных ему значений. */
export function submitAtsForm(
  vacancyId: string,
  values: Readonly<Record<string, string>>,
): Promise<AtsReceipt | null> {
  return invokeDesktopCommand<AtsReceipt>('ats_form_submit', {
    request: { vacancyId, confirmed: true, values },
  });
}

export function readAtsOutcome(vacancyId: string): Promise<AtsReceipt | null> {
  return invokeDesktopCommand<AtsReceipt>('ats_form_outcome', { vacancyId });
}

/** Показывает окно формы; вызывать только по нажатию кандидата (проверка, которую проходит он сам). */
export function showAtsForm(vacancyId: string): Promise<boolean | null> {
  return invokeDesktopCommand<boolean>('ats_form_show', { vacancyId });
}

export function closeAtsForm(): Promise<void | null> {
  return invokeDesktopCommand<void>('ats_form_close', {});
}
