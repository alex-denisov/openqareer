import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { AccountConnectionsManager } from '../connections/AccountConnections';
import { AccountNotificationsSection } from './AccountNotificationsSection';
import { useAccountCapabilityConsents } from './useAccountCapabilityConsents';
import { useAccountNotificationSettings } from './useAccountNotificationSettings';
import { appVersionLine } from '../shell/appVersion';
import { buildFreshnessLine, isBuildMarked } from '../shell/buildFreshness';
import { useBuildFreshness } from '../shell/useBuildFreshness';
import { MANDATORY_NOTIFICATION_EVENTS } from './accountData';
import type { AccountSnapshot, CandidateConnection } from '../coach/coachApi';
import type { AccountAppSettings, AccountConsent, AccountDevice, AccountSectionId, MobileAccountViewId } from './accountTypes';
import type { AccountDialogState, AccountTab, AccountViewModel, CareerAccountViewProps } from './accountViewTypes';

const DESKTOP_TABS: readonly AccountTab[] = [
  { id: 'prof', label: 'Профиль и вход' },
  { id: 'conn', label: 'Подключения' },
  { id: 'notif', label: 'Уведомления' },
  { id: 'cons', label: 'Согласия и данные' },
  { id: 'app', label: 'Приложение' },
  { id: 'pay', label: 'Подписка и платежи' },
];

export function useCareerAccountViewModel(props: CareerAccountViewProps): AccountViewModel {
  const appTabAvailable = props.isDesktopApp && !props.isMobile;
  const sections = useAccountViewSections(props, appTabAvailable);
  const dialogs = useAccountDialogState();
  const notifications = useAccountNotificationSettings();
  const capabilityConsents = useAccountCapabilityConsents();
  const appSettings = useAccountAppSettings(appTabAvailable);
  const devices = useMemo(() => mapAccountDevices(props.account), [props.account]);
  const displayName = props.account?.displayName ?? props.user.displayName;
  const email = props.account?.email ?? props.user.email;
  const connectionCount = connectionCountLabel(props.connections, props.user.emailVerified, notifications.telegramConnected, notifications.settingsReady);
  const content = useAccountViewContent(props, sections, notifications);
  const { onOpenDialog, onCloseDialog } = dialogs;
  const { confirmConsent } = capabilityConsents;
  const onToggleConsent = useCallback((consent: AccountConsent) => {
    onOpenDialog({ type: 'consent', consent });
  }, [onOpenDialog]);
  const onConfirmConsent = useCallback(async (consent: AccountConsent) => {
    if (await confirmConsent(consent)) onCloseDialog();
  }, [confirmConsent, onCloseDialog]);

  return {
    props,
    appTabAvailable,
    ...sections,
    ...dialogs,
    ...content,
    onToggleConsent,
    displayName,
    email,
    devices,
    connectionCount,
    appSettings,
    consents: capabilityConsents.consents,
    consentLoading: capabilityConsents.loading,
    consentBusyId: capabilityConsents.busyId,
    consentStatus: capabilityConsents.statusMessage,
    onConfirmConsent,
  };
}

function useAccountViewSections(props: CareerAccountViewProps, appTabAvailable: boolean) {
  const [section, setSection] = useState<AccountSectionId>(() =>
    props.initialSection === 'app' && !appTabAvailable ? 'prof' : props.initialSection,
  );
  const [mobileView, setMobileView] = useState<MobileAccountViewId>(
    props.initialMobileView ?? mobileViewForSection(props.initialSection),
  );
  const tabsRef = useRef<HTMLDivElement>(null);
  const tabs = useMemo(
    () => DESKTOP_TABS.filter((tab) => tab.id !== 'app' || appTabAvailable),
    [appTabAvailable],
  );
  useEffect(() => {
    setSection(props.initialSection);
    if (!props.initialMobileView) setMobileView(mobileViewForSection(props.initialSection));
  }, [props.initialMobileView, props.initialSection]);
  useEffect(() => {
    if (section === 'app' && !appTabAvailable) setSection('prof');
  }, [appTabAvailable, section]);
  const onSelectSection = useCallback((next: AccountSectionId) => {
    if (next !== 'app' || appTabAvailable) setSection(next);
  }, [appTabAvailable]);
  const onTabKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    const next = nextTabId(tabs, section, event.key);
    if (!next) return;
    event.preventDefault();
    onSelectSection(next);
    tabsRef.current?.querySelector<HTMLButtonElement>(`[data-account-tab="${next}"]`)?.focus();
  }, [onSelectSection, section, tabs]);
  return { section, mobileView, tabs, tabsRef, onSelectSection, onGoView: setMobileView, onTabKeyDown };
}

function nextTabId(tabs: readonly AccountTab[], current: AccountSectionId, key: string) {
  const ids = tabs.map((tab) => tab.id);
  const index = ids.indexOf(current);
  if (key === 'Home') return ids[0];
  if (key === 'End') return ids.at(-1);
  if (key === 'ArrowRight') return ids[(index + 1) % ids.length];
  if (key === 'ArrowLeft') return ids[(index - 1 + ids.length) % ids.length];
  return undefined;
}

function useAccountDialogState() {
  const [dialog, setDialog] = useState<AccountDialogState>(null);
  const [dialogError, setDialogError] = useState<string>();
  const onCloseDialog = useCallback(() => {
    setDialog(null);
    setDialogError(undefined);
  }, []);
  const onOpenDialog = useCallback((next: Exclude<AccountDialogState, null>) => {
    setDialogError(undefined);
    setDialog(next);
  }, []);
  return { dialog, dialogError, onCloseDialog, onOpenDialog, onError: setDialogError };
}

function useAccountAppSettings(appTabAvailable: boolean): AccountAppSettings {
  const buildSha = appTabAvailable ? __APP_COMMIT__ : '';
  const freshness = useBuildFreshness(buildSha);
  return {
    version: appVersionLine(__APP_VERSION__, __APP_COMMIT__),
    ...(appTabAvailable && isBuildMarked(buildSha) && freshness
      ? { freshnessLine: buildFreshnessLine(freshness) }
      : {}),
    autoUpdate: null,
    menuBar: null,
    launchAtLogin: null,
  };
}

function useAccountViewContent(
  props: CareerAccountViewProps,
  sections: ReturnType<typeof useAccountViewSections>,
  notifications: ReturnType<typeof useAccountNotificationSettings>,
) {
  const { onGoView, onSelectSection } = sections;
  const notificationsContent = (
    <AccountNotificationsSection {...notifications} mandatoryEvents={MANDATORY_NOTIFICATION_EVENTS} />
  );
  const onOpenNotifications = useCallback(() => {
    if (props.isMobile) onGoView('notif');
    else onSelectSection('notif');
  }, [props.isMobile, onGoView, onSelectSection]);
  const connectionsContent = (
    <AccountConnectionsManager
      initialConnections={props.connections}
      onConnectionsChange={props.onConnectionsChange}
      onDataChanged={props.onDataChanged}
      isMobile={props.isMobile}
      emailVerified={props.user.emailVerified}
      emailAvailable={notifications.emailAvailable}
      telegramAvailable={notifications.telegramAvailable}
      telegramConnected={notifications.telegramConnected}
      onOpenNotifications={onOpenNotifications}
      onBackMobile={() => onGoView('home')}
    />
  );
  return { notificationsContent, connectionsContent };
}

function mapAccountDevices(account?: AccountSnapshot): AccountDevice[] {
  return (account?.sessions ?? []).map((session) => ({
    id: session.id,
    kind: 'device',
    name: session.current ? 'Текущее устройство' : 'Устройство',
    details: `Последняя активность ${sessionDate(session.lastSeenAt)} · вход ${sessionDate(session.createdAt)}`,
    current: session.current,
  }));
}

function sessionDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'дата неизвестна';
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(date);
}

function mobileViewForSection(section: AccountSectionId): MobileAccountViewId {
  if (section === 'prof') return 'prof';
  if (section === 'conn') return 'conn';
  if (section === 'notif') return 'notif';
  if (section === 'cons') return 'cons';
  if (section === 'pay') return 'pay';
  return 'home';
}

function connectionCountLabel(
  connections: readonly CandidateConnection[] | undefined,
  emailVerified: boolean | undefined,
  telegramConnected: boolean,
  settingsReady: boolean,
): string | null {
  if (!connections || !settingsReady || emailVerified === undefined) return null;
  const count = connections.filter((connection) => connection.status === 'connected').length;
  return `${count + Number(emailVerified) + Number(telegramConnected)} из 6`;
}
