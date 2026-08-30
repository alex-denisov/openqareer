import { useEffect, useState } from 'react';
import {
  CoachApiError,
  disconnectConnection,
  getConnections,
  type CandidateConnection,
} from '../coach/coachApi';
import { isTauriEnvironment } from '../../services/desktop/desktopBridge';
import { PLATFORM_LABELS, type ConnectionPlatform } from './platformLabels';
import { HhConnectModal } from './HhConnectModal';
import { LinkedInConnectModal } from './LinkedInConnectModal';
import type { HhResumeItem } from './HhConnectModal';
import {
  importCandidateResume,
  type ResumeImportResult,
} from '../resume/resumeApi';
import type { ParsedResume } from '../workspace/resumeParser';
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
 * The product has no platform authorisation flow: hh.ru and LinkedIn are read
 * through the candidate's own session in the desktop companion (owner
 * decision, B156).
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

  /**
   * The dialog hands over one resume it has already read inside the
   * candidate's own session. The panel used to receive a bare list and read the
   * chosen resume through a window the dialog had already closed
   * (owner report, 2026-08-26).
   */
  async function handleHhSessionImport(
    _resumes: readonly HhResumeItem[],
    parsed: ParsedResume,
    sourceUrl: string,
  ) {
    setBusyPlatform('hh');
    setNotice(undefined);
    try {
      const persisted = await persistHhSessionImport({
        parsed,
        sourceUrl,
        capturedAt: new Date().toISOString(),
      });
      setConnections(persisted.connections);
      setNotice(
        `Резюме hh.ru сохранено в профиль: ${persisted.connection.factCount} фактов.`,
      );
    } catch (error) {
      setNotice(hhSessionImportError(error));
      throw error;
    } finally {
      setBusyPlatform(undefined);
    }
  }

  async function handleLinkedInSessionImport(parsed: ParsedResume, sourceUrl: string) {
    setBusyPlatform('linkedin');
    setNotice(undefined);
    try {
      const persisted = await persistNativeSessionImport({
        platform: 'linkedin',
        parsed,
        sourceUrl,
        capturedAt: new Date().toISOString(),
      });
      setConnections(persisted.connections);
      setNotice(
        `Профиль LinkedIn сохранён: ${persisted.connection.factCount} фактов.`,
      );
    } catch (error) {
      setNotice(nativeSessionImportError('linkedin', error));
      throw error;
    } finally {
      setBusyPlatform(undefined);
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
        onConnectSuccess={handleHhSessionImport}
        onAuthenticatedEmpty={() => {
          setNotice('Вход в hh.ru выполнен, но в аккаунте пока нет резюме.');
        }}
      />
      <LinkedInConnectModal
        isOpen={importPlatform === 'linkedin'}
        onClose={() => setImportPlatform(undefined)}
        onImportSuccess={handleLinkedInSessionImport}
        onConnectionFailure={setNotice}
      />
    </>
  );
}

interface PersistHhSessionInput {
  readonly platform?: 'hh';
  readonly parsed: ParsedResume;
  readonly sourceUrl: string;
  readonly capturedAt: string;
}

interface PersistNativeSessionInput {
  readonly platform: 'hh' | 'linkedin';
  readonly parsed: ParsedResume;
  readonly sourceUrl: string;
  readonly capturedAt: string;
}

interface PersistHhSessionDependencies {
  readonly importResume: typeof importCandidateResume;
  readonly loadConnections: typeof getConnections;
}

export async function persistHhSessionImport(
  input: PersistHhSessionInput,
  dependencies: PersistHhSessionDependencies = {
    importResume: importCandidateResume,
    loadConnections: getConnections,
  },
): Promise<{
  readonly connection: Extract<
    CandidateConnection,
    { status: 'connected'; accessMode: 'native_session_snapshot' }
  >;
  readonly connections: CandidateConnection[];
}> {
  return persistNativeSessionImport({ ...input, platform: 'hh' }, dependencies);
}

async function persistNativeSessionImport(
  input: PersistNativeSessionInput,
  dependencies: PersistHhSessionDependencies = {
    importResume: importCandidateResume,
    loadConnections: getConnections,
  },
): Promise<{
  readonly connection: Extract<
    CandidateConnection,
    { status: 'connected'; accessMode: 'native_session_snapshot' }
  >;
  readonly connections: CandidateConnection[];
}> {
  const imported: ResumeImportResult = await dependencies.importResume({
    text: input.parsed.rawText,
    source: input.platform,
    sourceReceipt: {
      platform: input.platform,
      accessMode: 'native_session_snapshot',
      sourceUrl: input.sourceUrl,
      capturedAt: input.capturedAt,
    },
  });
  if (
    imported.connection?.status !== 'connected' ||
    imported.connection.accessMode !== 'native_session_snapshot'
  ) {
    throw new Error('native_connection_receipt_missing');
  }
  const connections = await dependencies.loadConnections();
  const connection = connections.find(
    (candidate): candidate is Extract<
      CandidateConnection,
      { status: 'connected'; accessMode: 'native_session_snapshot' }
    > =>
      candidate.platform === input.platform &&
      candidate.status === 'connected' &&
      candidate.accessMode === 'native_session_snapshot',
  );
  if (!connection) throw new Error('native_connection_not_persisted');
  return { connection, connections };
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
                  <p>{connectionCopy(connection)}</p>
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
                  <small>{disconnectBoundaryCopy(connection)}</small>
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

function connectionCopy(connection: Extract<CandidateConnection, { status: 'connected' }>): string {
  if (connection.accessMode === 'native_session_snapshot') {
    const label = PLATFORM_LABELS[connection.platform];
    const source = connection.platform === 'hh' ? `резюме ${label}` : `профиля ${label}`;
    return `Снимок ${source} сохранён: ${connection.factCount} фактов. Сессия ${label} не хранится.`;
  }
  return connection.platform === 'linkedin'
    ? 'Профиль прочитан из вашей сессии LinkedIn; карьерная история живёт в Resume Studio.'
    : 'Резюме прочитаны из вашей сессии hh.ru; действий от вашего имени нет.';
}

function disconnectBoundaryCopy(
  connection: Extract<CandidateConnection, { status: 'connected' }>,
): string {
  return connection.accessMode === 'native_session_snapshot'
    ? 'Отключится только сохранённый статус площадки. Импортированные данные останутся в профиле.'
    : 'Локальные токены и снимок профиля будут удалены. Отзыв доступа на стороне площадки может потребовать отдельного отзыва.';
}

function connectionManagementError(error: unknown): string {
  if (error instanceof CoachApiError && error.code === 'unauthorized') {
    return 'Сессия закончилась. Войдите снова, чтобы проверить подключения.';
  }
  return 'Не удалось проверить подключения. Повторите после восстановления соединения.';
}

function hhSessionImportError(error: unknown): string {
  if (error instanceof CoachApiError && error.code === 'unauthorized') {
    return 'Сессия OpenQareer закончилась. Войдите снова и повторите импорт hh.ru.';
  }
  if (error instanceof Error && error.message === 'hh_resume_not_read') {
    return 'Вход в hh.ru выполнен, но выбранное резюме прочитать не удалось. Повторите проверку или загрузите PDF.';
  }
  return 'Резюме hh.ru прочитано, но сервер не подтвердил сохранение. Повторите импорт; статус подключения не изменён.';
}

function nativeSessionImportError(
  platform: ConnectionPlatform,
  error: unknown,
): string {
  if (error instanceof CoachApiError && error.code === 'unauthorized') {
    return `Сессия OpenQareer закончилась. Войдите снова и повторите импорт ${PLATFORM_LABELS[platform]}.`;
  }
  return `Данные ${PLATFORM_LABELS[platform]} прочитаны, но сервер не подтвердил сохранение. Повторите импорт.`;
}
