import { useState } from 'react';
import type {
  AccountConsent,
  AccountDevice,
  AccountSectionId,
  MobileAccountViewId,
} from './accountTypes';
import {
  DEFAULT_ACCOUNT_CONSENTS,
  DEFAULT_ACCOUNT_DEVICES,
  DEFAULT_APP_SETTINGS,
  DEFAULT_NOTIFICATION_EVENTS,
  DEFAULT_PAYMENT_HISTORY,
  MANDATORY_NOTIFICATION_EVENTS,
} from './accountData';
import {
  AccountConfirmDialog,
  AccountHhModal,
  AccountLinkedInModal,
} from './AccountDialogs';
import {
  AccountAppSettingsSection,
  AccountConnectionsSection,
  AccountConsentsSection,
  AccountNotificationsSection,
  AccountProfileSection,
  AccountSubscriptionSection,
} from './AccountDesktopSections';
import {
  MobileAccountConnections,
  MobileAccountConsents,
  MobileAccountDevices,
  MobileAccountEventDetail,
  MobileAccountHh,
  MobileAccountHome,
  MobileAccountLinkedIn,
  MobileAccountNotifications,
  MobileAccountProfile,
  MobileAccountSubscription,
} from './AccountMobileSections';
if (typeof document !== 'undefined') {
  void import('./account.css');
}

type AccountDialogState =
  | { type: 'logoutOther' }
  | { type: 'terminateDevice'; device: AccountDevice }
  | { type: 'revokeConsent'; consent: AccountConsent }
  | { type: 'grantConsent'; consent: AccountConsent }
  | { type: 'deleteAccount' }
  | { type: 'linkedin' }
  | { type: 'hh' }
  | null;

interface CareerAccountViewProps {
  readonly initialSection?: AccountSectionId;
  readonly initialMobileView?: MobileAccountViewId;
  readonly isPro?: boolean;
  readonly isMobile?: boolean;
  readonly onOpenTariffs?: () => void;
  readonly onClose?: () => void;
}

function useCareerAccountState(
  initialSection: AccountSectionId,
  initialMobileView: MobileAccountViewId,
  onClose?: () => void,
) {
  const [section, setSection] = useState<AccountSectionId>(initialSection);
  const [mobileView, setMobileView] = useState<MobileAccountViewId>(initialMobileView);
  const [devices, setDevices] = useState(DEFAULT_ACCOUNT_DEVICES);
  const [consents, setConsents] = useState(DEFAULT_ACCOUNT_CONSENTS);
  const [dialog, setDialog] = useState<AccountDialogState>(null);

  const handleToggleConsent = (c: AccountConsent) => {
    setDialog(c.date ? { type: 'revokeConsent', consent: c } : { type: 'grantConsent', consent: c });
  };
  const handleTerminateDevice = (d: AccountDevice) => {
    setDevices((curr) => curr.filter((item) => item.id !== d.id));
    setDialog(null);
  };
  const handleLogoutOtherDevices = () => {
    setDevices((curr) => curr.filter((item) => item.current));
    setDialog(null);
  };
  const handleConfirmRevoke = (c: AccountConsent) => {
    setConsents((curr) => curr.map((item) => (item.id === c.id ? { ...item, date: '' } : item)));
    setDialog(null);
  };
  const handleConfirmGrant = (c: AccountConsent) => {
    setConsents((curr) => curr.map((item) => (item.id === c.id ? { ...item, date: '09.10' } : item)));
    setDialog(null);
  };
  const handleDeleteAccount = () => {
    setDialog(null);
    onClose?.();
  };

  return {
    section,
    setSection,
    mobileView,
    setMobileView,
    devices,
    consents,
    dialog,
    setDialog,
    handleToggleConsent,
    handleTerminateDevice,
    handleLogoutOtherDevices,
    handleConfirmRevoke,
    handleConfirmGrant,
    handleDeleteAccount,
  };
}

function MobileAccountViewBranch({
  state,
  isPro,
  onOpenTariffs,
}: {
  readonly state: ReturnType<typeof useCareerAccountState>;
  readonly isPro: boolean;
  readonly onOpenTariffs?: () => void;
}) {
  return (
    <MobileAccountRoot
      mobileView={state.mobileView}
      isPro={isPro}
      devices={state.devices}
      consents={state.consents}
      onGoView={state.setMobileView}
      onTerminateDevice={(d) => state.setDialog({ type: 'terminateDevice', device: d })}
      onLogoutOtherDevices={() => state.setDialog({ type: 'logoutOther' })}
      onToggleConsent={state.handleToggleConsent}
      onDeleteAccount={() => state.setDialog({ type: 'deleteAccount' })}
      onOpenTariffs={onOpenTariffs}
      onManageLinkedIn={() => state.setMobileView('li')}
      onManageHh={() => state.setMobileView('hh')}
    />
  );
}

function DesktopAccountViewBranch({
  state,
  isPro,
  onOpenTariffs,
}: {
  readonly state: ReturnType<typeof useCareerAccountState>;
  readonly isPro: boolean;
  readonly onOpenTariffs?: () => void;
}) {
  return (
    <DesktopAccountRoot
      section={state.section}
      isPro={isPro}
      devices={state.devices}
      consents={state.consents}
      onSelectSection={state.setSection}
      onTerminateDevice={(d) => state.setDialog({ type: 'terminateDevice', device: d })}
      onLogoutOtherDevices={() => state.setDialog({ type: 'logoutOther' })}
      onManageLinkedIn={() => state.setDialog({ type: 'linkedin' })}
      onManageHh={() => state.setDialog({ type: 'hh' })}
      onToggleConsent={state.handleToggleConsent}
      onExportAll={() => undefined}
      onDeleteAccount={() => state.setDialog({ type: 'deleteAccount' })}
      onOpenTariffs={onOpenTariffs}
    />
  );
}

export function CareerAccountView({
  initialSection = 'prof',
  initialMobileView = 'home',
  isPro = false,
  isMobile = false,
  onOpenTariffs,
  onClose,
}: CareerAccountViewProps) {
  const state = useCareerAccountState(initialSection, initialMobileView, onClose);

  return (
    <div className="career-account-container">
      {isMobile ? (
        <MobileAccountViewBranch state={state} isPro={isPro} onOpenTariffs={onOpenTariffs} />
      ) : (
        <DesktopAccountViewBranch state={state} isPro={isPro} onOpenTariffs={onOpenTariffs} />
      )}
      <CareerAccountDialogsHost
        dialog={state.dialog}
        onCloseDialog={() => state.setDialog(null)}
        onTerminateDevice={state.handleTerminateDevice}
        onLogoutOtherDevices={state.handleLogoutOtherDevices}
        onConfirmRevoke={state.handleConfirmRevoke}
        onConfirmGrant={state.handleConfirmGrant}
        onDeleteAccount={state.handleDeleteAccount}
      />
    </div>
  );
}

interface DialogHostProps {
  readonly dialog: AccountDialogState;
  readonly onCloseDialog: () => void;
  readonly onTerminateDevice: (d: AccountDevice) => void;
  readonly onLogoutOtherDevices: () => void;
  readonly onConfirmRevoke: (c: AccountConsent) => void;
  readonly onConfirmGrant: (c: AccountConsent) => void;
  readonly onDeleteAccount: () => void;
}

function DeviceDialogs(props: DialogHostProps) {
  const { dialog, onCloseDialog } = props;
  if (dialog?.type === 'logoutOther') {
    return (
      <AccountConfirmDialog
        title="Выйти на других устройствах?"
        description="Сессии на других браузерах будут завершены, в этой сессии вы останетесь."
        confirmLabel="Выйти"
        isDanger
        onConfirm={props.onLogoutOtherDevices}
        onCancel={onCloseDialog}
      />
    );
  }
  if (dialog?.type === 'terminateDevice') {
    return (
      <AccountConfirmDialog
        title="Завершить сессию?"
        description={`Вход на устройстве «${dialog.device.name}» будет завершён.`}
        confirmLabel="Завершить"
        isDanger
        onConfirm={() => props.onTerminateDevice(dialog.device)}
        onCancel={onCloseDialog}
      />
    );
  }
  return null;
}

function ConsentDialogs(props: DialogHostProps) {
  const { dialog, onCloseDialog } = props;
  if (dialog?.type === 'revokeConsent') {
    return (
      <AccountConfirmDialog
        title="Отозвать согласие?"
        description={`«${dialog.consent.title}». ${dialog.consent.consequences}`}
        confirmLabel="Отозвать"
        isDanger
        onConfirm={() => props.onConfirmRevoke(dialog.consent)}
        onCancel={onCloseDialog}
      />
    );
  }
  if (dialog?.type === 'grantConsent') {
    return (
      <AccountConfirmDialog
        title="Согласие дано"
        description={`«${dialog.consent.title}». Дата сохранена.`}
        confirmLabel="Понятно"
        onConfirm={() => props.onConfirmGrant(dialog.consent)}
        onCancel={onCloseDialog}
      />
    );
  }
  return null;
}

function DeviceOrConsentDialog(props: DialogHostProps) {
  if (props.dialog?.type === 'logoutOther' || props.dialog?.type === 'terminateDevice') {
    return <DeviceDialogs {...props} />;
  }
  return <ConsentDialogs {...props} />;
}

function CareerAccountDialogsHost(props: DialogHostProps) {
  const { dialog, onCloseDialog } = props;
  if (!dialog) return null;
  if (dialog.type === 'deleteAccount') {
    return (
      <AccountConfirmDialog
        title="Удалить аккаунт?"
        description="Профиль и данные будут удалены безвозвратно через 7 дней."
        confirmLabel="Удалить аккаунт"
        isDanger
        onConfirm={props.onDeleteAccount}
        onCancel={onCloseDialog}
      />
    );
  }
  if (dialog.type === 'linkedin') {
    return <AccountLinkedInModal onClose={onCloseDialog} onDisconnect={onCloseDialog} onReimport={onCloseDialog} />;
  }
  if (dialog.type === 'hh') {
    return <AccountHhModal onClose={onCloseDialog} onDisconnect={onCloseDialog} onReimport={onCloseDialog} />;
  }
  return <DeviceOrConsentDialog {...props} />;
}

interface DesktopAccountRootProps {
  readonly section: AccountSectionId;
  readonly isPro: boolean;
  readonly devices: readonly AccountDevice[];
  readonly consents: readonly AccountConsent[];
  readonly onSelectSection: (s: AccountSectionId) => void;
  readonly onTerminateDevice: (d: AccountDevice) => void;
  readonly onLogoutOtherDevices: () => void;
  readonly onManageLinkedIn: () => void;
  readonly onManageHh: () => void;
  readonly onToggleConsent: (c: AccountConsent) => void;
  readonly onExportAll: () => void;
  readonly onDeleteAccount: () => void;
  readonly onOpenTariffs?: () => void;
}

const DESKTOP_TABS: readonly { readonly id: AccountSectionId; readonly label: string; readonly badge?: string }[] = [
  { id: 'prof', label: 'Профиль и вход' },
  { id: 'conn', label: 'Подключения', badge: '2 из 6' },
  { id: 'notif', label: 'Уведомления' },
  { id: 'cons', label: 'Согласия и данные' },
  { id: 'app', label: 'Приложение' },
  { id: 'pay', label: 'Подписка и платежи' },
];

function DesktopAccountTablist({
  section,
  onSelectSection,
}: {
  readonly section: AccountSectionId;
  readonly onSelectSection: (s: AccountSectionId) => void;
}) {
  return (
    <div className="career-account-tablist" role="tablist" aria-label="Аккаунт">
      {DESKTOP_TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={section === tab.id}
          className={`career-account-tab-btn ${section === tab.id ? 'is-active' : ''}`}
          onClick={() => onSelectSection(tab.id)}
        >
          {tab.label}
          {tab.badge ? <span className="career-account-tab-badge">{tab.badge}</span> : null}
        </button>
      ))}
    </div>
  );
}

function DesktopSectionContent(props: DesktopAccountRootProps) {
  if (props.section === 'prof') {
    return (
      <AccountProfileSection
        devices={props.devices}
        onTerminateDevice={props.onTerminateDevice}
        onLogoutOtherDevices={props.onLogoutOtherDevices}
      />
    );
  }
  if (props.section === 'conn') {
    return (
      <AccountConnectionsSection
        onManageLinkedIn={props.onManageLinkedIn}
        onManageHh={props.onManageHh}
      />
    );
  }
  if (props.section === 'notif') {
    return (
      <AccountNotificationsSection
        events={DEFAULT_NOTIFICATION_EVENTS}
        mandatoryEvents={MANDATORY_NOTIFICATION_EVENTS}
      />
    );
  }
  if (props.section === 'cons') {
    return (
      <AccountConsentsSection
        consents={props.consents}
        onToggleConsent={props.onToggleConsent}
        onExportAll={props.onExportAll}
        onDeleteAccount={props.onDeleteAccount}
      />
    );
  }
  if (props.section === 'app') {
    return <AccountAppSettingsSection settings={DEFAULT_APP_SETTINGS} />;
  }
  return (
    <AccountSubscriptionSection
      isPro={props.isPro}
      payments={DEFAULT_PAYMENT_HISTORY}
      onOpenTariffs={props.onOpenTariffs}
    />
  );
}

function DesktopAccountRoot(props: DesktopAccountRootProps) {
  return (
    <div className="career-account-screen">
      <div className="career-account-head">
        <h2 className="career-account-title">Аккаунт</h2>
        <p className="career-account-lead">
          Профиль и вход, подключения, уведомления, согласия, приложение и подписка.
        </p>
      </div>
      <DesktopAccountTablist
        section={props.section}
        onSelectSection={props.onSelectSection}
      />
      <DesktopSectionContent {...props} />
    </div>
  );
}

interface MobileAccountRootProps {
  readonly mobileView: MobileAccountViewId;
  readonly isPro: boolean;
  readonly devices: readonly AccountDevice[];
  readonly consents: readonly AccountConsent[];
  readonly onGoView: (v: MobileAccountViewId) => void;
  readonly onTerminateDevice: (d: AccountDevice) => void;
  readonly onLogoutOtherDevices: () => void;
  readonly onToggleConsent: (c: AccountConsent) => void;
  readonly onDeleteAccount: () => void;
  readonly onOpenTariffs?: () => void;
  readonly onManageLinkedIn: () => void;
  readonly onManageHh: () => void;
}

function MobileProfileViews(props: MobileAccountRootProps) {
  if (props.mobileView === 'prof') {
    return (
      <MobileAccountProfile
        onBack={() => props.onGoView('home')}
        onGoDevices={() => props.onGoView('dev')}
      />
    );
  }
  if (props.mobileView === 'dev') {
    return (
      <MobileAccountDevices
        devices={props.devices}
        onBack={() => props.onGoView('prof')}
        onTerminateDevice={props.onTerminateDevice}
        onLogoutOtherDevices={props.onLogoutOtherDevices}
      />
    );
  }
  if (props.mobileView === 'conn') {
    return (
      <MobileAccountConnections
        onBack={() => props.onGoView('home')}
        onGoLinkedIn={props.onManageLinkedIn}
        onGoHh={props.onManageHh}
      />
    );
  }
  if (props.mobileView === 'li') {
    return <MobileAccountLinkedIn onBack={() => props.onGoView('conn')} onDisconnect={() => props.onGoView('conn')} />;
  }
  return <MobileAccountHh onBack={() => props.onGoView('conn')} onDisconnect={() => props.onGoView('conn')} />;
}

function MobileUtilityViews(props: MobileAccountRootProps) {
  if (props.mobileView === 'notif') {
    return (
      <MobileAccountNotifications
        events={DEFAULT_NOTIFICATION_EVENTS}
        onBack={() => props.onGoView('home')}
        onSelectEvent={(idx) => props.onGoView(`ev${idx}` as MobileAccountViewId)}
      />
    );
  }
  if (props.mobileView.startsWith('ev')) {
    const idx = Number(props.mobileView.replace('ev', ''));
    const ev = DEFAULT_NOTIFICATION_EVENTS[idx] ?? DEFAULT_NOTIFICATION_EVENTS[0];
    return <MobileAccountEventDetail event={ev} onBack={() => props.onGoView('notif')} />;
  }
  if (props.mobileView === 'cons') {
    return (
      <MobileAccountConsents
        consents={props.consents}
        onBack={() => props.onGoView('home')}
        onToggleConsent={props.onToggleConsent}
        onDeleteAccount={props.onDeleteAccount}
      />
    );
  }
  if (props.mobileView === 'pay') {
    return (
      <MobileAccountSubscription
        isPro={props.isPro}
        payments={DEFAULT_PAYMENT_HISTORY}
        onBack={() => props.onGoView('home')}
        onOpenTariffs={props.onOpenTariffs}
      />
    );
  }
  return <MobileAccountHome isPro={props.isPro} onGoView={props.onGoView} />;
}

function MobileAccountRoot(props: MobileAccountRootProps) {
  const profileViews: readonly MobileAccountViewId[] = ['prof', 'dev', 'conn', 'li', 'hh'];
  if (profileViews.includes(props.mobileView)) {
    return <MobileProfileViews {...props} />;
  }
  return <MobileUtilityViews {...props} />;
}
