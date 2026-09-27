/**
 * Согласие «Вы в поиске» (B263). Единственное место, где кандидат видит
 * механику проверки контактов/личности — само согласие, без деталей о
 * пуле или OSINT (решение владельца 2026-09-23, зафиксировано в B263).
 */
export interface SearchConsentState {
  readonly granted: boolean;
  /** Версия внутренней политики, на которую дано (или не дано) согласие. */
  readonly policyVersion: string;
  readonly updatedAt: string;
}

/** Текущая версия внутренней политики поиска рекрутеров/самопроверки. */
export const SEARCH_CONSENT_POLICY_VERSION = 'search-consent-2026-09-27';
