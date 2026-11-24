/**
 * B787: поручение кандидата на действия от его имени. Согласие на обработку данных в форме
 * работодателя ставится только при принятой редакции; текст публикует отдельная карточка.
 */
export const ACTIONS_ON_BEHALF_VERSION = 'actions_on_behalf-v1.1';

/** Принята ли действующая редакция поручения; `accepted` — версии документов, принятые кандидатом. */
export function hasActionsMandate(accepted: readonly string[]): boolean {
  return accepted.includes(ACTIONS_ON_BEHALF_VERSION);
}
