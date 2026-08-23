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
