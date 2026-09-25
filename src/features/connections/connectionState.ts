import {
  type CandidateConnection,
  type DisconnectedConnection,
} from '../coach/coachApi';
import { PLATFORM_LABELS, type ConnectionPlatform } from './platformLabels';

/** Every refusal is reported as what the candidate can do next. */
/** What happened to the platform sign-in kept by the desktop app. */
export type DeviceSessionOutcome = 'forgotten' | 'failed' | 'none';

export function connectionDisconnectNotice(
  result: DisconnectedConnection,
  device: DeviceSessionOutcome = 'none',
): string {
  const label = PLATFORM_LABELS[result.platform];
  if (!result.connectionRemoved) {
    return `Не удалось отключить ${label}. Сохранённый снимок подключения не изменён; повторите позже.`;
  }
  const retained =
    'Импортированные данные остаются в вашем профиле; удалить их можно отдельно в разделе данных.';
  if (device === 'forgotten') {
    // One device store serves both platforms, so both sign-ins go (B266 review).
    return `${label} отключён. Входы в LinkedIn и hh.ru на этом устройстве забыты. ${retained}`;
  }
  if (device === 'failed') {
    return `${label} отключён, но вход в ${label} на этом устройстве забыть не удалось. Перезапустите приложение и отключите ${label} ещё раз. ${retained}`;
  }
  return `${label} отключён. OpenQareer сессию ${label} не хранит. ${retained}`;
}

export interface DisconnectDependencies {
  readonly disconnect: (platform: ConnectionPlatform) => Promise<DisconnectedConnection>;
  readonly forgetDeviceSession: (platform: ConnectionPlatform) => Promise<boolean>;
  readonly isDesktop: boolean;
}

/**
 * «Отключить» in the account used to drop only the server record; the desktop
 * app kept the platform cookies, so the next «Подключить» signed in silently
 * (B266). The device session is forgotten after the server disconnect.
 */
export async function disconnectAndForgetSession(
  platform: ConnectionPlatform,
  dependencies: DisconnectDependencies,
): Promise<{ result: DisconnectedConnection; device: DeviceSessionOutcome }> {
  const result = await dependencies.disconnect(platform);
  if (!dependencies.isDesktop || !result.connectionRemoved) return { result, device: 'none' };
  const forgotten = await dependencies.forgetDeviceSession(platform).catch(() => false);
  return { result, device: forgotten ? 'forgotten' : 'failed' };
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
