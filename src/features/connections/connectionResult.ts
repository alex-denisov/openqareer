const CONNECTION_RESULT_PATH = '/connections/result';

const CONNECTION_PLATFORMS = ['linkedin', 'hh'] as const;

export type ConnectionPlatform = (typeof CONNECTION_PLATFORMS)[number];

const RESULT_STATUSES = ['connected', 'declined', 'failed'] as const;

const RESULT_REASONS = [
  'connector_not_configured',
  'oauth_state_invalid',
  'provider_oauth_failed',
  'provider_profile_unavailable',
] as const;

export interface ConnectionResult {
  platform: ConnectionPlatform;
  status: (typeof RESULT_STATUSES)[number];
  reason?: (typeof RESULT_REASONS)[number];
}

export const PLATFORM_LABELS: Record<ConnectionPlatform, string> = {
  linkedin: 'LinkedIn',
  hh: 'hh.ru',
};

/**
 * The callback lands the candidate on one fixed same-origin route. Only values
 * this product itself can emit are accepted; anything else is treated as a
 * normal page load so a crafted link cannot script the outcome banner.
 */
export function readConnectionResult(location: {
  pathname: string;
  search: string;
}): ConnectionResult | null {
  if (location.pathname.replace(/\/$/u, '') !== CONNECTION_RESULT_PATH) {
    return null;
  }
  const query = new URLSearchParams(location.search);
  const platform = CONNECTION_PLATFORMS.find(
    (value) => value === query.get('platform'),
  );
  const status = RESULT_STATUSES.find((value) => value === query.get('status'));
  if (!platform || !status) return null;
  const reason = RESULT_REASONS.find((value) => value === query.get('reason'));
  return reason ? { platform, status, reason } : { platform, status };
}

export function connectionResultMessage(result: ConnectionResult): string {
  const platform = PLATFORM_LABELS[result.platform];
  if (result.status === 'connected') {
    return result.platform === 'linkedin'
      ? `${platform} подключён. Этот доступ даёт только базовые поля профиля и не переносит карьерную историю — опыт по-прежнему берётся из вашего экспорта или PDF.`
      : `${platform} подключён. Мы читаем ваш профиль и резюме и ничего не делаем от вашего имени.`;
  }
  if (result.status === 'declined') {
    return `Доступ не выдан: вы отменили подключение ${platform}. Ничего не сохранено, можно продолжить без подключения.`;
  }
  switch (result.reason) {
    case 'oauth_state_invalid':
      return `Ссылка подключения ${platform} истекла или уже использована. Начните подключение заново.`;
    case 'connector_not_configured':
      return `Подключение ${platform} ещё не настроено на сервере. Загрузите свой экспорт или PDF.`;
    case 'provider_profile_unavailable':
      return `${platform} выдал доступ, но не вернул профиль. Ничего не сохранено — повторите позже или используйте экспорт.`;
    default:
      return `Площадка ${platform} не подтвердила доступ. Ничего не сохранено — повторите подключение позже.`;
  }
}
