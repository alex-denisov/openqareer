import { useEffect, useState } from 'react';
import {
  CoachApiError,
  disconnectConnection,
  getConnections,
  startConnection,
  type CandidateConnection,
} from '../coach/coachApi';
import { PLATFORM_LABELS, type ConnectionPlatform } from './connectionResult';
import {
  applyConnectionDisconnectResult,
  connectionDisconnectNotice,
  connectionStartNotice,
} from './connectionState';
import { PlatformConnectionPanel } from './PlatformConnectionPanel';

interface AccountConnectionsProps {
  connections: CandidateConnection[];
  busyPlatform?: ConnectionPlatform;
  notice?: string;
  onConnect: (platform: ConnectionPlatform) => void;
  onDisconnect: (platform: ConnectionPlatform) => void;
}

export function AccountConnectionsManager() {
  const [connections, setConnections] = useState<CandidateConnection[]>();
  const [busyPlatform, setBusyPlatform] = useState<ConnectionPlatform>();
  const [notice, setNotice] = useState<string>();

  useEffect(() => {
    let current = true;
    void getConnections()
      .then((loaded) => {
        if (current) setConnections(loaded);
      })
      .catch((error: unknown) => {
        if (current) setNotice(connectionManagementError(error));
      });
    return () => {
      current = false;
    };
  }, []);

  /**
   * The connection starts where the account is. The wizard used to own this
   * button while it only ever ran for anonymous visitors, so no candidate could
   * reach it and this panel pointed at a step that could not deliver.
   */
  async function handleConnect(platform: ConnectionPlatform) {
    setBusyPlatform(platform);
    setNotice(undefined);
    try {
      const started = await startConnection(platform);
      window.location.assign(started.authorizationUrl);
    } catch (error) {
      setBusyPlatform(undefined);
      setNotice(connectionStartNotice(error, platform));
    }
  }

  async function handleDisconnect(platform: ConnectionPlatform) {
    setBusyPlatform(platform);
    setNotice(undefined);
    try {
      const result = await disconnectConnection(platform);
      setConnections((current) =>
        current ? applyConnectionDisconnectResult(current, result) : current,
      );
      setNotice(connectionDisconnectNotice(result));
    } catch (error) {
      setNotice(connectionManagementError(error));
    } finally {
      setBusyPlatform(undefined);
    }
  }

  if (!connections) {
    return (
      <section className="career-account-connections" aria-live="polite" aria-busy="true">
        <h2>Подключённые площадки</h2>
        <p>{notice ?? 'Проверяем подключения…'}</p>
      </section>
    );
  }

  return (
    <AccountConnections
      connections={connections}
      busyPlatform={busyPlatform}
      notice={notice}
      onConnect={(platform) => void handleConnect(platform)}
      onDisconnect={(platform) => void handleDisconnect(platform)}
    />
  );
}

export function AccountConnections({
  connections,
  busyPlatform,
  notice,
  onConnect,
  onDisconnect,
}: AccountConnectionsProps) {
  return (
    <section className="career-account-connections" aria-labelledby="career-account-connections-title">
      <div>
        <h2 id="career-account-connections-title">Подключённые площадки</h2>
        <p>Доступ хранится отдельно для этого аккаунта кандидата.</p>
      </div>
      <div className="career-account-connection-list">
        {connections.map((connection) => {
          const label = PLATFORM_LABELS[connection.platform];
          return (
            <article key={connection.platform}>
              <div className="career-connection-headline">
                <strong>{label}</strong>
                <span className={connection.status === 'connected' ? 'is-connected' : undefined}>
                  {connection.status === 'connected' ? 'Подключено' : 'Не подключено'}
                </span>
              </div>
              {connection.status === 'connected' ? (
                <>
                  <p>{connectionCopy(connection.platform)}</p>
                  <button
                    className="career-quiet-button"
                    type="button"
                    disabled={busyPlatform === connection.platform}
                    onClick={() => onDisconnect(connection.platform)}
                  >
                    {busyPlatform === connection.platform
                      ? 'Отключаем…'
                      : `Отключить ${label}`}
                  </button>
                  <small>
                    Локальные токены и снимок профиля будут удалены. Отзыв доступа
                    на стороне площадки может потребовать отдельного отзыва.
                  </small>
                </>
              ) : connection.available ? (
                <PlatformConnectionPanel
                  platform={connection.platform}
                  busy={busyPlatform === connection.platform}
                  onConnect={() => onConnect(connection.platform)}
                />
              ) : (
                <p>Официальное подключение пока не настроено.</p>
              )}
            </article>
          );
        })}
      </div>
      {notice ? <p className="career-inline-note" role="status">{notice}</p> : null}
    </section>
  );
}

function connectionCopy(platform: ConnectionPlatform): string {
  return platform === 'linkedin'
    ? 'Официальный доступ даёт базовые поля профиля и не переносит карьерную историю.'
    : 'Официальный доступ читает профиль и резюме; действий от вашего имени нет.';
}

function connectionManagementError(error: unknown): string {
  if (error instanceof CoachApiError && error.code === 'unauthorized') {
    return 'Сессия закончилась. Войдите снова, чтобы проверить подключения.';
  }
  return 'Не удалось проверить подключения. Повторите после восстановления соединения.';
}
