import {
  type CandidateConnection,
  type DisconnectedConnection,
} from '../coach/coachApi';
import { PLATFORM_LABELS } from './platformLabels';

/** Every refusal is reported as what the candidate can do next. */
export function connectionDisconnectNotice(
  result: DisconnectedConnection,
): string {
  const label = PLATFORM_LABELS[result.platform];
  if (!result.connectionRemoved) {
    return `Не удалось отключить ${label}. Сохранённый снимок подключения не изменён; повторите позже.`;
  }
  const retained =
    'Импортированные данные остаются в вашем профиле; удалить их можно отдельно в разделе данных.';
  return `${label} отключён. OpenQareer сессию ${label} не хранит. ${retained}`;
}

export function applyConnectionDisconnectResult(
  connections: CandidateConnection[],
  result: DisconnectedConnection,
): CandidateConnection[] {
  if (!result.connectionRemoved) return connections;
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
