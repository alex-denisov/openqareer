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
  type NativeImportMode,
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
import {
  scheduleLinkedInContactsRefresh,
  startLinkedInContactsRefresh,
} from './linkedinContactsRefresh';
import { startLinkedInCompanySearch } from './linkedinCompanySearch';
import {
  canImportLinkedInInBackground,
  LINKEDIN_BACKGROUND_NOTICE,
  startLinkedInBackgroundImport,
  type LinkedInReadyCapture,
} from './linkedinBackgroundImport';
import { AccountConnectionsSection } from '../account/AccountDesktopSections';
import { AccountHhModal, AccountLinkedInModal } from '../account/AccountDialogs';
import { MobileAccountConnections } from '../account/AccountMobileSections';
import { ProfileReplaceOffer } from './ProfileReplaceOffer';
import { useLinkedInContactsSummary } from './linkedinContactsSummary';

interface ReplaceOffer {
  readonly platform: 'hh' | 'linkedin';
  readonly replace: () => Promise<PersistedNativeImport>;
}

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
  const linkedinContacts = useLinkedInContactsSummary(managePlatform === 'linkedin');
  const [replaceOffer, setReplaceOffer] = useState<ReplaceOffer>();
  // «Заменить профиль данными с …» from the manage dialog: the next sign-in replaces.
  const [replaceIntent, setReplaceIntent] = useState<'hh' | 'linkedin'>();
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

  const linkedinConnected = connections.some(
    (connection) => connection.platform === 'linkedin' && connection.status === 'connected',
  );
  // B448: contacts only, at most once per 24 h, never the profile. B561: then
  // the current companies, searched in the 1st circle on their own budget.
  useEffect(() => {
    if (!linkedinConnected) return undefined;
    return scheduleLinkedInContactsRefresh(
      () =>
        void startLinkedInContactsRefresh(true).then(() => startLinkedInCompanySearch(true)),
    );
  }, [linkedinConnected]);

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
    setReplaceOffer(undefined);
    try {
      const input = { parsed, sourceUrl, capturedAt: new Date().toISOString() };
      const replace = () => persistHhSessionImport({ ...input, importMode: 'replace_profile' });
      if (replaceIntent === 'hh') {
        setReplaceIntent(undefined);
        await handleReplaceProfile({ platform: 'hh', replace });
        return;
      }
      settleImport('hh', await persistHhSessionImport(input), replace);
    } catch (error) {
      setNotice(hhSessionImportError(error));
      throw error;
    } finally {
      setBusyPlatform(undefined);
    }
  }

  async function handleLinkedInSessionImport(
    parsed: ParsedResume,
    rawUrl: string,
    structured?: LinkedInStructuredCapture,
    structuredFallback?: StructuredFallbackReason,
  ) {
    await saveLinkedInCapture(
      { status: 'ready', parsed, rawUrl, structured, structuredFallback },
      replaceIntent === 'linkedin',
    );
  }

  /** Saves one LinkedIn capture and returns what the candidate is told. */
  async function saveLinkedInCapture(
    capture: LinkedInReadyCapture,
    replaceProfile: boolean,
  ): Promise<string> {
    setBusyPlatform('linkedin');
    setNotice(undefined);
    setReplaceOffer(undefined);
    try {
      const replace = () => persistLinkedInCapture(capture, 'replace_profile');
      if (replaceProfile) {
        setReplaceIntent(undefined);
        const replaced = await handleReplaceProfile({ platform: 'linkedin', replace });
        if (!replaced) throw new Error('linkedin_replace_failed');
        return replaced;
      }
      return settleImport('linkedin', await persistLinkedInCapture(capture), replace);
    } catch (error) {
      setNotice(nativeSessionImportError('linkedin', error));
      throw error;
    } finally {
      setBusyPlatform(undefined);
    }
  }

  /**
   * «Импортировать заново» reads LinkedIn out of sight in the desktop app
   * (owner, 30.10): the window shows up only if LinkedIn needs a person.
   */
  function reimportLinkedIn(replaceProfile: boolean) {
    setManagePlatform(undefined);
    if (!canImportLinkedInInBackground()) {
      if (replaceProfile) setReplaceIntent('linkedin');
      setImportPlatform('linkedin');
      return;
    }
    setNotice(LINKEDIN_BACKGROUND_NOTICE);
    void startLinkedInBackgroundImport((capture) => saveLinkedInCapture(capture, replaceProfile));
  }

  /** One import source per profile (23.10.2026): a second platform only connects. */
  function settleImport(
    platform: 'hh' | 'linkedin',
    persisted: PersistedNativeImport,
    replace: () => Promise<PersistedNativeImport>,
  ): string {
    publishConnections(persisted.connections);
    const message = nativeImportNotice(platform, persisted);
    setNotice(message);
    if (persisted.connectOnly) {
      setReplaceOffer({ platform, replace });
      return message;
    }
    onDataChanged?.();
    return message;
  }

  function replaceFromManage(platform: 'hh' | 'linkedin') {
    if (platform === 'linkedin') {
      reimportLinkedIn(true);
      return;
    }
    setManagePlatform(undefined);
    setReplaceIntent(platform);
    setImportPlatform(platform);
  }

  function closeImport() {
    setImportPlatform(undefined);
    setReplaceIntent(undefined);
  }

  /** The saved notice, or `undefined` when the replace failed and said so. */
  async function handleReplaceProfile(offer: ReplaceOffer): Promise<string | undefined> {
    setBusyPlatform(offer.platform);
    try {
      const persisted = await offer.replace();
      setReplaceOffer(undefined);
      publishConnections(persisted.connections);
      const message = `Профиль заменён данными с ${PLATFORM_LABELS[offer.platform]}: ${factNoun(persisted.connection.factCount)}.`;
      setNotice(message);
      onDataChanged?.();
      return message;
    } catch (error) {
      setNotice(nativeSessionImportError(offer.platform, error));
      return undefined;
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

  // B464: the sign-in window exists only in the desktop app; the browser offers no path that cannot finish.
  const canSignIn = isTauriEnvironment();
  const isConnected = (platform: ConnectionPlatform) =>
    connections.some((connection) => connection.platform === platform && connection.status === 'connected');
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
      onGoLinkedIn={
        isConnected('linkedin') ? () => setManagePlatform('linkedin') : canSignIn ? () => setImportPlatform('linkedin') : undefined
      }
      onGoHh={isConnected('hh') ? () => setManagePlatform('hh') : canSignIn ? () => setImportPlatform('hh') : undefined}
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
      onConnectLinkedIn={canSignIn ? () => setImportPlatform('linkedin') : undefined}
      onConnectHh={canSignIn ? () => setImportPlatform('hh') : undefined}
      onOpenNotifications={onOpenNotifications}
      onConnectTelegram={onOpenNotifications}
    />
  );

  return (
    <>
      {connectionContent}
      {replaceOffer ? (
        <ProfileReplaceOffer
          platform={replaceOffer.platform}
          busy={busyPlatform === replaceOffer.platform}
          onReplace={() => void handleReplaceProfile(replaceOffer)}
        />
      ) : null}
      {managedConnection?.platform === 'linkedin' && managedConnection.status === 'connected' ? (
        <AccountLinkedInModal
          connection={managedConnection}
          busy={busyPlatform === 'linkedin'}
          connectOnly={connectedOnly(managedConnection, connections)}
          contacts={linkedinContacts}
          onReplaceProfile={canSignIn ? () => replaceFromManage('linkedin') : undefined}
          onClose={() => setManagePlatform(undefined)}
          onDisconnect={() => {
            setManagePlatform(undefined);
            void handleDisconnect('linkedin');
          }}
          onReimport={canSignIn ? () => reimportLinkedIn(false) : undefined}
        />
      ) : null}
      {managedConnection?.platform === 'hh' && managedConnection.status === 'connected' ? (
        <AccountHhModal
          connection={managedConnection}
          busy={busyPlatform === 'hh'}
          connectOnly={connectedOnly(managedConnection, connections)}
          onReplaceProfile={canSignIn ? () => replaceFromManage('hh') : undefined}
          onClose={() => setManagePlatform(undefined)}
          onDisconnect={() => {
            setManagePlatform(undefined);
            void handleDisconnect('hh');
          }}
          onReimport={
            canSignIn
              ? () => {
                  setManagePlatform(undefined);
                  setImportPlatform('hh');
                }
              : undefined
          }
        />
      ) : null}
      <HhConnectModal
        isOpen={importPlatform === 'hh'}
        isReconnect={Boolean(connections.some((connection) => connection.platform === 'hh' && connection.status === 'connected'))}
        connectOnly={replaceIntent !== 'hh' && profileBuiltFrom(connections, 'linkedin')}
        onClose={closeImport}
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
        onClose={closeImport}
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
  readonly importMode?: NativeImportMode;
}

interface PersistNativeSessionInput {
  readonly platform: 'hh' | 'linkedin';
  readonly parsed: ParsedResume;
  readonly structuredFallback?: StructuredFallbackReason;
  readonly sourceUrl: string;
  readonly capturedAt: string;
  readonly importMode?: NativeImportMode;
}

type ConnectedNativeSource = Extract<
  CandidateConnection,
  { status: 'connected'; accessMode: 'native_session_snapshot' }
>;

export interface PersistedNativeImport {
  readonly connection: ConnectedNativeSource;
  readonly connections: CandidateConnection[];
  /** Only connected: the profile still comes from the other platform. */
  readonly connectOnly: boolean;
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
): Promise<PersistedNativeImport> {
  return persistNativeSessionImport({ ...input, platform: 'hh' }, dependencies);
}

async function persistNativeSessionImport(
  input: PersistNativeSessionInput,
  dependencies: PersistHhSessionDependencies = {
    importResume: importCandidateResume,
    loadConnections: getConnections,
  },
): Promise<PersistedNativeImport> {
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
    ...(input.importMode ? { importMode: input.importMode } : {}),
  });
  return confirmNativeConnection(input.platform, imported, dependencies.loadConnections);
}

async function confirmNativeConnection(
  platform: 'hh' | 'linkedin',
  imported: ResumeImportResult | StructuredResumeImportResult,
  loadConnections: typeof getConnections,
): Promise<PersistedNativeImport> {
  if (
    imported.connection?.status !== 'connected' ||
    imported.connection.accessMode !== 'native_session_snapshot'
  ) {
    throw new Error('native_connection_receipt_missing');
  }
  const connections = await loadConnections();
  const connection = connections.find(
    (candidate): candidate is ConnectedNativeSource =>
      candidate.platform === platform &&
      candidate.status === 'connected' &&
      candidate.accessMode === 'native_session_snapshot',
  );
  if (!connection) throw new Error('native_connection_not_persisted');
  // A replay without the flag still connected only if another platform builds the profile.
  const profileElsewhere = profileBuiltFrom(connections, platform === 'hh' ? 'linkedin' : 'hh');
  const connectOnly =
    imported.connectOnly === true || (connection.factCount === 0 && profileElsewhere);
  return { connection, connections, connectOnly };
}

interface PersistStructuredLinkedInInput {
  readonly profile: LinkedInProfileV2;
  readonly extractorVersion: string;
  readonly droppedFields?: readonly string[];
  readonly sourceUrl: string;
  readonly capturedAt: string;
  readonly importMode?: NativeImportMode;
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
): Promise<PersistedNativeImport> {
  const imported: StructuredResumeImportResult = await dependencies.importStructuredProfile({
    profile: input.profile,
    extractorVersion: input.extractorVersion,
    ...(input.droppedFields ? { droppedFields: input.droppedFields } : {}),
    sourceUrl: input.sourceUrl,
    capturedAt: input.capturedAt,
    ...(input.importMode ? { importMode: input.importMode } : {}),
  });
  return confirmNativeConnection('linkedin', imported, dependencies.loadConnections);
}

/** Connected without importing: no facts here, the profile comes from the other platform. */
function connectedOnly(
  connection: Extract<CandidateConnection, { status: 'connected' }>,
  connections: readonly CandidateConnection[],
): boolean {
  const other = connection.platform === 'hh' ? 'linkedin' : 'hh';
  return connection.factCount === 0 && profileBuiltFrom(connections, other);
}

function profileBuiltFrom(
  connections: readonly CandidateConnection[],
  platform: 'hh' | 'linkedin',
): boolean {
  return connections.some(
    (connection) =>
      connection.platform === platform &&
      connection.status === 'connected' &&
      connection.accessMode === 'native_session_snapshot' &&
      connection.factCount > 0,
  );
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

/** What the candidate is told once a native import is saved. */
export function nativeImportNotice(
  platform: 'hh' | 'linkedin',
  persisted: PersistedNativeImport,
): string {
  if (persisted.connectOnly) return `${PLATFORM_LABELS[platform]} подключён. Профиль не изменился.`;
  return `Из ${PLATFORM_LABELS[platform]} сохранено ${factNoun(persisted.connection.factCount)}.`;
}

/** Saves a LinkedIn capture: the structured profile when it was read, else the text. */
export function persistLinkedInCapture(
  capture: LinkedInReadyCapture,
  importMode?: NativeImportMode,
): Promise<PersistedNativeImport> {
  const capturedAt = new Date().toISOString();
  const { structured } = capture;
  if (structured) {
    return persistStructuredLinkedInImport({
      profile: structured.profile,
      extractorVersion: structured.extractorVersion,
      ...(structured.droppedFields ? { droppedFields: structured.droppedFields } : {}),
      sourceUrl: capture.rawUrl,
      capturedAt,
      ...(importMode ? { importMode } : {}),
    });
  }
  return persistNativeSessionImport({
    platform: 'linkedin',
    parsed: capture.parsed,
    ...(capture.structuredFallback ? { structuredFallback: capture.structuredFallback } : {}),
    sourceUrl: capture.rawUrl,
    capturedAt,
    ...(importMode ? { importMode } : {}),
  });
}

function factNoun(count: number): string {
  return pluralRu(count, ['факт', 'факта', 'фактов']);
}
