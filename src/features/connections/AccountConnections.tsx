import { useEffect, useState } from 'react';
import {
  CoachApiError,
  disconnectConnection,
  getConnections,
  type CandidateConnection,
} from '../coach/coachApi';
import { isTauriEnvironment } from '../../services/desktop/desktopBridge';
import { PLATFORM_LABELS, type ConnectionPlatform } from './connectionResult';
import { HhConnectModal } from './HhConnectModal';
import { LinkedInConnectModal } from './LinkedInConnectModal';
import {
  applyConnectionDisconnectResult,
  connectionDisconnectNotice,
} from './connectionState';

interface AccountConnectionsProps {
  connections: CandidateConnection[];
  busyPlatform?: ConnectionPlatform;
  notice?: string;
  isDesktop?: boolean;
  onDisconnect: (platform: ConnectionPlatform) => void;
  onSessionImport?: (platform: ConnectionPlatform) => void;
}

/**
 * The product has no platform OAuth: hh.ru and LinkedIn are read through the
 * candidate's own session in the desktop companion (owner decision, B156).
 * This panel therefore offers session import, never an official-connect
 * button that could only end in "not configured".
 */
export function AccountConnectionsManager() {
  const [connections, setConnections] = useState<CandidateConnection[]>();
  const [busyPlatform, setBusyPlatform] = useState<ConnectionPlatform>();
  const [notice, setNotice] = useState<string>();
  const [importPlatform, setImportPlatform] = useState<ConnectionPlatform>();

  useEffect(() => {
    let current = true;
    void getConnections()
      .then((loaded) => {
        if (current) setConnections(loaded);
      })
      .catch((error) => {
        if (!current) return;
        setNotice(connectionManagementError(error));
        setConnections([]);
      });
    return () => {
      current = false;
    };
  }, []);

  async function refreshAfterSessionImport(platformLabel: string) {
    try {
      setConnections(await getConnections());
      setNotice(`Профиль ${platformLabel} импортирован в ваш кабинет.`);
    } catch {
      // The import itself already succeeded; the list catches up on next load.
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
    <>
      <AccountConnections
        connections={connections}
        busyPlatform={busyPlatform}
        notice={notice}
        isDesktop={isTauriEnvironment()}
        onDisconnect={(platform) => void handleDisconnect(platform)}
        onSessionImport={setImportPlatform}
      />
      <HhConnectModal
        isOpen={importPlatform === 'hh'}
        onClose={() => setImportPlatform(undefined)}
        onConnectSuccess={() => void refreshAfterSessionImport('hh.ru')}
      />
      <LinkedInConnectModal
        isOpen={importPlatform === 'linkedin'}
        onClose={() => setImportPlatform(undefined)}
        onImportSuccess={() => void refreshAfterSessionImport('LinkedIn')}
      />
    </>
  );
}

export function AccountConnections({
  connections,
  busyPlatform,
  notice,
  isDesktop = false,
  onDisconnect,
  onSessionImport,
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
              ) : isDesktop ? (
                <div className="career-connection-panel">
                  <button
                    className="career-primary-button"
                    type="button"
                    onClick={() => onSessionImport?.(connection.platform)}
                  >
                    {busyPlatform === connection.platform
                      ? 'Подключаем…'
                      : `Подключить ${label}`}
                  </button>
                </div>
              ) : (
                <p>Профиль {label} подключается в десктопном приложении OpenQareer.</p>
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
    ? 'Профиль прочитан из вашей сессии LinkedIn; карьерная история живёт в Resume Studio.'
    : 'Резюме прочитаны из вашей сессии hh.ru; действий от вашего имени нет.';
}

function connectionManagementError(error: unknown): string {
  if (error instanceof CoachApiError && error.code === 'unauthorized') {
    return 'Сессия закончилась. Войдите снова, чтобы проверить подключения.';
  }
  return 'Не удалось проверить подключения. Повторите после восстановления соединения.';
}
