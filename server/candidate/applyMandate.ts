import { CAPABILITY_CONSENT_CURRENT_VERSION } from '../../src/features/legal/capabilityConsents';
import type { SqliteCapabilityConsentStore } from '../auth/capabilityConsentStore';

/** Действующая версия поручения на отклик (B787). */
export const APPLY_MANDATE_VERSION = CAPABILITY_CONSENT_CURRENT_VERSION.actions_on_behalf;

export const APPLY_MANDATE_REQUIRED = 'apply_mandate_required';

/**
 * B787: принял ли кандидат действующее поручение. Одна проверка для откликов hh, движка форм и
 * действий от имени кандидата; нет хранилища — считается, что не принял.
 */
export function hasApplyMandate(
  store: Pick<SqliteCapabilityConsentStore, 'hasConsentVersion'> | undefined,
  candidateId: string,
): boolean {
  return store?.hasConsentVersion(candidateId, 'actions_on_behalf', APPLY_MANDATE_VERSION) ?? false;
}
