import { CAPABILITY_CONSENT_CURRENT_VERSION } from '../../../legal/capabilityConsents';

/**
 * B787: поручение кандидата на действия от его имени. Согласие на обработку данных в форме
 * работодателя ставится только при принятой редакции.
 */
export const ACTIONS_ON_BEHALF_VERSION = CAPABILITY_CONSENT_CURRENT_VERSION.actions_on_behalf;

/** Принята ли действующая редакция поручения; `accepted` — версии документов, принятые кандидатом. */
export function hasApplyMandate(accepted: readonly string[]): boolean {
  return accepted.includes(ACTIONS_ON_BEHALF_VERSION);
}
