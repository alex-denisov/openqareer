import {
  type CandidateConnection,
  type DisconnectedConnection,
} from '../coach/coachApi';
import { PLATFORM_LABELS } from './connectionResult';

/** Every refusal is reported as what the candidate can do next. */
export function connectionDisconnectNotice(
  result: DisconnectedConnection,
): string {
  const label = PLATFORM_LABELS[result.platform];
  if (result.accessMode === 'native_session_snapshot') {
    if (!result.connectionRemoved) {
      return `Не удалось отключить ${label}. Сохранённый снимок подключения не изменён; повторите позже.`;
    }
    const retained =
      'Импортированные данные остаются в вашем профиле; удалить их можно отдельно в разделе данных.';
    if (result.oauthCleanup?.upstreamRevocation === 'failed') {
      return `${label} отключён в OpenQareer, но площадка не подтвердила отзыв прежнего OAuth-доступа. Проверьте доступы в ${label}. ${retained}`;
    }
    if (
      result.oauthCleanup?.localDataRemoved &&
      result.oauthCleanup.upstreamRevocation === 'unsupported'
    ) {
      return `${label} отключён; прежние локальные OAuth-токены удалены. Автоматический отзыв на площадке не поддерживается — проверьте доступы в ${label}. ${retained}`;
    }
    return `${label} отключён. OpenQareer сессию ${label} не хранит. ${retained}`;
  }
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
  const removed =
    result.accessMode === 'native_session_snapshot'
      ? result.connectionRemoved
      : result.localDataRemoved;
  if (!removed) return connections;
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
