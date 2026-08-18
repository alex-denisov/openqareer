import {
  CoachApiError,
  type CandidateConnection,
  type DisconnectedConnection,
} from '../coach/coachApi';
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
      return `Подключение ${label} ещё не настроено в этой среде — загрузите свой экспорт или PDF.`;
    default:
      return `Не удалось начать подключение ${label}. Повторите позже или используйте экспорт и PDF.`;
  }
}

export function connectionDisconnectNotice(
  result: DisconnectedConnection,
): string {
  const label = PLATFORM_LABELS[result.platform];
  if (!result.localDataRemoved) {
    return `Не удалось удалить локальные данные ${label}. Подключение не изменено; повторите позже.`;
  }
  if (result.upstreamRevocation === 'revoked') {
    return `${label} отключён: данные удалены из OpenQareer, доступ на площадке отозван.`;
  }
  if (result.upstreamRevocation === 'failed') {
    return `${label} отключён в OpenQareer, но площадка не подтвердила отзыв доступа. Проверьте доступы в ${label}.`;
  }
  return `${label} отключён: токены и снимок профиля удалены из OpenQareer. Автоматический отзыв не поддерживается — проверьте доступы в ${label}.`;
}

export function applyConnectionDisconnectResult(
  connections: CandidateConnection[],
  result: DisconnectedConnection,
): CandidateConnection[] {
  if (!result.localDataRemoved) return connections;
  return connections.map((connection) =>
    connection.platform === result.platform
      ? {
          platform: connection.platform,
          available: connection.available,
          capabilities: [...connection.capabilities],
          importsCareerHistory: connection.importsCareerHistory,
          status: 'disconnected',
        }
      : connection,
  );
}
