import { CoachApiError } from '../coach/coachApi';
import { PLATFORM_LABELS, type ConnectionPlatform } from './connectionResult';

/**
 * A candidate without an account is not a failure: connections are stored per
 * account, so the honest answer is what is missing, not an error.
 */
export function accountRequiredNotice(platform: ConnectionPlatform): string {
  return `Подключение ${PLATFORM_LABELS[platform]} доступно после создания аккаунта — прогресс без аккаунта хранится только в этой вкладке.`;
}

/** Every refusal is reported as what the candidate can do next. */
export function connectionStartNotice(
  error: unknown,
  platform: ConnectionPlatform,
): string {
  const label = PLATFORM_LABELS[platform];
  if (!(error instanceof CoachApiError)) {
    return `Не удалось начать подключение ${label}. Загрузка экспорта и PDF работает без него.`;
  }
  switch (error.code) {
    case 'unauthorized':
      return accountRequiredNotice(platform);
    case 'connector_not_configured':
      return `Подключение ${label} ещё не настроено. Мы не обходим ограничения площадки — загрузите свой экспорт или PDF.`;
    default:
      return `Не удалось начать подключение ${label}. Повторите позже или используйте экспорт и PDF.`;
  }
}
