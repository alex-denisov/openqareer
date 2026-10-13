import { useCallback, useEffect, useState } from 'react';
import {
  CoachApiError,
  disconnectConnection,
  getConnections,
  type CandidateConnection,
} from '../coach/coachApi';
import { isTauriEnvironment } from '../../services/desktop/desktopBridge';
import { PLATFORM_LABELS, type ConnectionPlatform } from './platformLabels';
import { pluralRu } from '../../../shared/pluralRu';
import { HhConnectModal } from './HhConnectModal';
import { LinkedInConnectModal } from './LinkedInConnectModal';
import type { HhResumeItem } from './HhConnectModal';
import {
  importCandidateResume,
  importStructuredLinkedInProfile,
  type ResumeImportResult,
  type StructuredResumeImportResult,
} from '../resume/resumeApi';
import type { ParsedResume } from '../workspace/resumeParser';
import type { LinkedInProfileV2 } from '../../../shared/linkedinProfileV2';
import type { LinkedInStructuredCapture, StructuredFallbackReason } from './linkedinSessionPoll';
import {
  applyConnectionDisconnectResult,
  connectionDisconnectNotice,
  disconnectAndForgetSession,
} from './connectionState';
import { resetConnectorSession } from './connectorSession';
import { AccountConnectionsSection } from '../account/AccountDesktopSections';
import { AccountHhModal, AccountLinkedInModal } from '../account/AccountDialogs';
import { MobileAccountConnections } from '../account/AccountMobileSections';

/**
 * The product has no platform authorisation flow: hh.ru and LinkedIn are read
 * through the candidate's own session in the desktop companion (owner
 * decision, B156).
 * This panel therefore offers session import, never an official-connect
 * button that could only end in "not configured".
 */
export interface AccountConnectionsManagerProps {
  readonly initialConnections?: readonly CandidateConnection[];
  readonly onConnectionsChange?: (connections: CandidateConnection[]) => void;
  readonly onDataChanged?: () => void;
  readonly isMobile?: boolean;
  readonly emailVerified?: boolean;
  readonly emailAvailable?: boolean;
  readonly telegramAvailable?: boolean;
  readonly telegramConnected?: boolean;
  readonly onOpenNotifications?: () => void;
  readonly onBackMobile?: () => void;
}

export function AccountConnectionsManager({
  initialConnections,
  onConnectionsChange,
  onDataChanged,
  isMobile = false,
  emailVerified,
  emailAvailable = false,
  telegramAvailable = false,
  telegramConnected = false,
  onOpenNotifications = () => undefined,
  onBackMobile = () => undefined,
}: AccountConnectionsManagerProps) {
  const [connections, setConnections] = useState<CandidateConnection[]>(
    () => (initialConnections ? [...initialConnections] : []),
  );
  const [connectionsReady, setConnectionsReady] = useState(Boolean(initialConnections));
  const [busyPlatform, setBusyPlatform] = useState<ConnectionPlatform>();
  const [notice, setNotice] = useState<string>();
  const [importPlatform, setImportPlatform] = useState<ConnectionPlatform>();
  const [managePlatform, setManagePlatform] = useState<ConnectionPlatform>();
  const publishConnections = useCallback((next: CandidateConnection[]) => {
    setConnections(next);
    setConnectionsReady(true);
    onConnectionsChange?.(next);
  }, [onConnectionsChange]);

  useEffect(() => {
    let current = true;
    if (initialConnections) {
      setConnections([...initialConnections]);
      setConnectionsReady(true);
      return () => {
        current = false;
      };
    }
    void getConnections()
      .then((loaded) => {
        if (current) publishConnections(loaded);
      })
      .catch((error) => {
        if (!current) return;
        setNotice(connectionManagementError(error));
        publishConnections([]);
      });
    return () => {
      current = false;
    };
  }, [initialConnections, publishConnections]);

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
      publishConnections(persisted.connections);
      setNotice(
        `Из ${PLATFORM_LABELS.hh} сохранено ${factNoun(persisted.connection.factCount)}.`,
      );
      onDataChanged?.();
    } catch (error) {
      setNotice(hhSessionImportError(error));
      throw error;
    } finally {
      setBusyPlatform(undefined);
    }
  }

  async function handleLinkedInSessionImport(
    parsed: ParsedResume,
    sourceUrl: string,
    structured?: LinkedInStructuredCapture,
    structuredFallback?: StructuredFallbackReason,
  ) {
    setBusyPlatform('linkedin');
    setNotice(undefined);
    try {
      const persisted = structured
        ? await persistStructuredLinkedInImport({
            profile: structured.profile,
            extractorVersion: structured.extractorVersion,
            ...(structured.droppedFields ? { droppedFields: structured.droppedFields } : {}),
            sourceUrl,
            capturedAt: new Date().toISOString(),
          })
        : await persistNativeSessionImport({
            platform: 'linkedin',
            parsed,
            ...(structuredFallback ? { structuredFallback } : {}),
            sourceUrl,
            capturedAt: new Date().toISOString(),
          });
      publishConnections(persisted.connections);
      setNotice(
        `Из ${PLATFORM_LABELS.linkedin} сохранено ${factNoun(persisted.connection.factCount)}.`,
      );
      onDataChanged?.();
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
      const { result, device } = await disconnectAndForgetSession(platform, {
        disconnect: disconnectConnection,
        forgetDeviceSession: resetConnectorSession,
        isDesktop: isTauriEnvironment(),
      });
      publishConnections(applyConnectionDisconnectResult(connections, result));
      setNotice(connectionDisconnectNotice(result, device));
      onDataChanged?.();
    } catch (error) {
      setNotice(connectionManagementError(error));
    } finally {
      setBusyPlatform(undefined);
    }
  }

  if (!connectionsReady) {
    return (
      <section className="career-account-connections" aria-live="polite" aria-busy="true">
        <h2>Подключённые площадки</h2>
        <p>{notice ?? 'Проверяем подключения…'}</p>
      </section>
    );
  }

  const managedConnection = connections.find((connection) => connection.platform === managePlatform);

  const connectionContent = isMobile ? (
    <MobileAccountConnections
      connections={connections}
      isLoading={!connectionsReady}
      notice={notice}
      emailVerified={emailVerified}
      emailAvailable={emailAvailable}
      telegramAvailable={telegramAvailable}
      telegramConnected={telegramConnected}
      onBack={onBackMobile}
      onGoLinkedIn={() =>
        connections.some((connection) => connection.platform === 'linkedin' && connection.status === 'connected')
          ? setManagePlatform('linkedin')
          : setImportPlatform('linkedin')
      }
      onGoHh={() =>
        connections.some((connection) => connection.platform === 'hh' && connection.status === 'connected')
          ? setManagePlatform('hh')
          : setImportPlatform('hh')
      }
      onOpenNotifications={onOpenNotifications}
    />
  ) : (
    <AccountConnectionsSection
      connections={connections}
      isLoading={!connectionsReady}
      busyPlatform={busyPlatform}
      notice={notice}
      emailVerified={emailVerified}
      emailAvailable={emailAvailable}
      telegramAvailable={telegramAvailable}
      telegramConnected={telegramConnected}
      isDesktopApp={isTauriEnvironment()}
      onManageLinkedIn={() => setManagePlatform('linkedin')}
      onManageHh={() => setManagePlatform('hh')}
      onConnectLinkedIn={() => setImportPlatform('linkedin')}
      onConnectHh={() => setImportPlatform('hh')}
      onOpenNotifications={onOpenNotifications}
      onConnectTelegram={onOpenNotifications}
    />
  );

  return (
    <>
      {connectionContent}
      {managedConnection?.platform === 'linkedin' && managedConnection.status === 'connected' ? (
        <AccountLinkedInModal
          connection={managedConnection}
          busy={busyPlatform === 'linkedin'}
          onClose={() => setManagePlatform(undefined)}
          onDisconnect={() => {
            setManagePlatform(undefined);
            void handleDisconnect('linkedin');
          }}
          onReimport={() => {
            setManagePlatform(undefined);
            setImportPlatform('linkedin');
          }}
        />
      ) : null}
      {managedConnection?.platform === 'hh' && managedConnection.status === 'connected' ? (
        <AccountHhModal
          connection={managedConnection}
          busy={busyPlatform === 'hh'}
          onClose={() => setManagePlatform(undefined)}
          onDisconnect={() => {
            setManagePlatform(undefined);
            void handleDisconnect('hh');
          }}
          onReimport={() => {
            setManagePlatform(undefined);
            setImportPlatform('hh');
          }}
        />
      ) : null}
      <HhConnectModal
        isOpen={importPlatform === 'hh'}
        isReconnect={Boolean(connections.some((connection) => connection.platform === 'hh' && connection.status === 'connected'))}
        onClose={() => setImportPlatform(undefined)}
        onConnectSuccess={handleHhSessionImport}
        onAuthenticatedEmpty={() => {
          setNotice(
            'Вход на площадку выполнен, но резюме там пока нет. Создайте резюме на площадке или загрузите файл здесь.',
          );
        }}
      />
      <LinkedInConnectModal
        isOpen={importPlatform === 'linkedin'}
        isReconnect={Boolean(connections.some((connection) => connection.platform === 'linkedin' && connection.status === 'connected'))}
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
  readonly structuredFallback?: StructuredFallbackReason;
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
    ...(input.structuredFallback ? { structuredFallback: input.structuredFallback } : {}),
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

interface PersistStructuredLinkedInInput {
  readonly profile: LinkedInProfileV2;
  readonly extractorVersion: string;
  readonly droppedFields?: readonly string[];
  readonly sourceUrl: string;
  readonly capturedAt: string;
}

interface PersistStructuredLinkedInDependencies {
  readonly importStructuredProfile: typeof importStructuredLinkedInProfile;
  readonly loadConnections: typeof getConnections;
}

/**
 * The DOM was already read and parsed on the candidate's device
 * (`extractStructuredLinkedInProfile`, B266); this path skips the text
 * importer entirely so the server never runs its text reader over the
 * structured facts.
 */
export async function persistStructuredLinkedInImport(
  input: PersistStructuredLinkedInInput,
  dependencies: PersistStructuredLinkedInDependencies = {
    importStructuredProfile: importStructuredLinkedInProfile,
    loadConnections: getConnections,
  },
): Promise<{
  readonly connection: Extract<
    CandidateConnection,
    { status: 'connected'; accessMode: 'native_session_snapshot' }
  >;
  readonly connections: CandidateConnection[];
}> {
  const imported: StructuredResumeImportResult = await dependencies.importStructuredProfile({
    profile: input.profile,
    extractorVersion: input.extractorVersion,
    ...(input.droppedFields ? { droppedFields: input.droppedFields } : {}),
    sourceUrl: input.sourceUrl,
    capturedAt: input.capturedAt,
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
      candidate.platform === 'linkedin' &&
      candidate.status === 'connected' &&
      candidate.accessMode === 'native_session_snapshot',
  );
  if (!connection) throw new Error('native_connection_not_persisted');
  return { connection, connections };
}

function connectionManagementError(error: unknown): string {
  if (error instanceof CoachApiError && error.code === 'unauthorized') {
    return 'Вы вышли из OpenQareer. Войдите снова, чтобы увидеть подключения.';
  }
  return 'Не удалось проверить подключения. Повторите после восстановления соединения.';
}

function hhSessionImportError(error: unknown): string {
  if (error instanceof CoachApiError && error.code === 'unauthorized') {
    return 'Вы вышли из OpenQareer. Войдите снова и повторите подключение площадки.';
  }
  if (error instanceof Error && error.message === 'hh_resume_not_read') {
    return 'Вход выполнен, но выбранное резюме прочитать не удалось. Повторите подключение или загрузите резюме файлом.';
  }
  return 'Резюме прочитано, но сохранить не удалось. Повторите подключение — статус площадки не изменился.';
}

function nativeSessionImportError(
  platform: ConnectionPlatform,
  error: unknown,
): string {
  if (error instanceof CoachApiError && error.code === 'unauthorized') {
    return 'Вы вышли из OpenQareer. Войдите снова и повторите подключение площадки.';
  }
  return `Данные с ${PLATFORM_LABELS[platform]} прочитаны, но сохранить не удалось. Повторите подключение.`;
}

function factNoun(count: number): string {
  return pluralRu(count, ['факт', 'факта', 'фактов']);
}
