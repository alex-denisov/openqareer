import { useState } from 'react';
import { DownloadSimple, SignOut, Trash } from '@phosphor-icons/react';
import type { AccountSnapshot, AuthUser } from '../coach/coachApi';
import { initialsFor } from '../shell/accountIdentity';
import { TimezoneSelect } from '../shell/TimezoneSelect';
import { MIN_PASSWORD_LENGTH } from '../../../shared/accountValidation';
import {
  AccountAppSettingsSection,
  AccountConsentsSection,
  AccountNotificationsSection,
  AccountSubscriptionSection,
} from './AccountDesktopSections';
import { AccountConfirmDialog } from './AccountDialogs';
import { AccountConnectionsManager } from '../connections/AccountConnections';
import {
  DEFAULT_APP_SETTINGS,
  DEFAULT_NOTIFICATION_EVENTS,
  DEFAULT_PAYMENT_HISTORY,
  MANDATORY_NOTIFICATION_EVENTS,
  DEFAULT_ACCOUNT_CONSENTS,
} from './accountData';
import type { AccountConsent, AccountSection } from './accountTypes';

export type { AccountSection };

const ACCOUNT_SECTION_LABELS: Record<AccountSection, string> = {
  security: 'Безопасность',
  connections: 'Подключения',
  notif: 'Уведомления',
  data: 'Согласия и данные',
  app: 'Приложение',
  pay: 'Подписка и платежи',
};

const ACCOUNT_SECTION_LEADS: Record<AccountSection, string> = {
  security: 'Управление доступом, паролем и сессиями на устройствах.',
  connections: 'Интеграции с карьерными площадками, почтой и сервисами.',
  notif: 'Каналы и поводы для сообщений о статусе поиска и событиях.',
  data: 'Согласия на обработку, экспорт копии данных и удаление аккаунта.',
  app: 'Параметры настольного приложения и автообновления.',
  pay: 'Действующий тариф, история списаний и чеки.',
};

interface AuthenticatedAccountProps {
  readonly user: AuthUser;
  readonly account?: AccountSnapshot;
  readonly section: AccountSection;
  readonly busy: boolean;
  readonly onSectionChange: (section: AccountSection) => void;
  readonly onSavePassword: (e: React.FormEvent<HTMLFormElement>) => Promise<void>;
  readonly onSaveTimezone: (e: React.FormEvent<HTMLFormElement>) => Promise<void>;
  readonly onCloseOtherSessions: () => Promise<void>;
  readonly onDownloadExport: () => Promise<void>;
  readonly onDeleteAccount: (e: React.FormEvent<HTMLFormElement>) => Promise<void>;
  readonly onSignOut: () => Promise<void>;
  readonly onDataChanged?: () => void;
  readonly onOpenTariffs?: () => void;
}

export function AuthenticatedAccount(props: AuthenticatedAccountProps) {
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [activeConsentDialog, setActiveConsentDialog] = useState<AccountConsent | null>(null);
  const [consents, setConsents] = useState(DEFAULT_ACCOUNT_CONSENTS);

  const handleConfirmConsent = () => {
    if (!activeConsentDialog) return;
    setConsents((curr) =>
      curr.map((item) =>
        item.id === activeConsentDialog.id
          ? { ...item, date: item.date ? '' : '09.10' }
          : item,
      ),
    );
    setActiveConsentDialog(null);
  };

  return (
    <>
      <AccountUserHeader user={props.user} account={props.account} />
      <AccountNavTabs section={props.section} onSectionChange={props.onSectionChange} />
      <p className="career-account-section-lead">{ACCOUNT_SECTION_LEADS[props.section]}</p>
      <AccountTabRouter
        {...props}
        consents={consents}
        onToggleConsent={(c) => setActiveConsentDialog(c)}
        onOpenLogoutConfirm={() => setShowLogoutConfirm(true)}
        onOpenDeleteConfirm={() => setShowDeleteConfirm(true)}
      />
      <button
        className="career-account-signout"
        type="button"
        disabled={props.busy}
        onClick={() => void props.onSignOut()}
      >
        <SignOut size={18} /> Выйти
      </button>
      <AccountModalsHost
        showLogout={showLogoutConfirm}
        showDelete={showDeleteConfirm}
        activeConsent={activeConsentDialog}
        onCloseLogout={() => setShowLogoutConfirm(false)}
        onCloseDelete={() => setShowDeleteConfirm(false)}
        onCloseConsent={() => setActiveConsentDialog(null)}
        onConfirmConsent={handleConfirmConsent}
        onCloseOtherSessions={props.onCloseOtherSessions}
        onDeleteAccount={props.onDeleteAccount}
      />
    </>
  );
}

function AccountUserHeader({
  user,
  account,
}: {
  readonly user: AuthUser;
  readonly account?: AccountSnapshot;
}) {
  return (
    <div className="career-account-current">
      <span className="career-account-avatar career-rail-avatar" aria-hidden="true">
        {initialsFor(account?.displayName ?? user.displayName ?? user.username)}
      </span>
      <div>
        <span>Вы вошли как</span>
        <strong>{account?.displayName ?? user.displayName ?? user.username}</strong>
        <small>{account?.email ?? user.email ?? user.username}</small>
      </div>
    </div>
  );
}

function AccountNavTabs({
  section,
  onSectionChange,
}: {
  readonly section: AccountSection;
  readonly onSectionChange: (section: AccountSection) => void;
}) {
  const tabs: readonly AccountSection[] = [
    'security',
    'connections',
    'notif',
    'data',
    'app',
    'pay',
  ];
  return (
    <nav className="career-account-tabs" aria-label="Настройки аккаунта">
      {tabs.map((item) => (
        <button
          key={item}
          type="button"
          className={section === item ? 'is-active' : ''}
          aria-current={section === item ? 'page' : undefined}
          onClick={() => onSectionChange(item)}
        >
          {ACCOUNT_SECTION_LABELS[item]}
        </button>
      ))}
    </nav>
  );
}

interface TabRouterProps extends AuthenticatedAccountProps {
  readonly consents: readonly AccountConsent[];
  readonly onToggleConsent: (c: AccountConsent) => void;
  readonly onOpenLogoutConfirm: () => void;
  readonly onOpenDeleteConfirm: () => void;
}

function AccountTabRouter(props: TabRouterProps) {
  if (props.section === 'connections') {
    return <AccountConnectionsManager onDataChanged={props.onDataChanged} />;
  }
  if (props.section === 'security') {
    return (
      <AccountSecurityTab
        account={props.account}
        busy={props.busy}
        onSaveTimezone={props.onSaveTimezone}
        onSavePassword={props.onSavePassword}
        onOpenLogoutConfirm={props.onOpenLogoutConfirm}
      />
    );
  }
  if (props.section === 'data') {
    return (
      <AccountDataTab
        consents={props.consents}
        busy={props.busy}
        onToggleConsent={props.onToggleConsent}
        onDownloadExport={props.onDownloadExport}
        onOpenDeleteConfirm={props.onOpenDeleteConfirm}
        onDeleteAccount={props.onDeleteAccount}
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
  if (props.section === 'app') {
    return <AccountAppSettingsSection settings={DEFAULT_APP_SETTINGS} />;
  }
  return (
    <AccountSubscriptionSection
      isPro={false}
      payments={DEFAULT_PAYMENT_HISTORY}
      onOpenTariffs={props.onOpenTariffs}
    />
  );
}

function TimezoneForm({
  account,
  busy,
  onSaveTimezone,
}: {
  readonly account?: AccountSnapshot;
  readonly busy: boolean;
  readonly onSaveTimezone: (e: React.FormEvent<HTMLFormElement>) => Promise<void>;
}) {
  return (
    <form className="career-account-form" onSubmit={onSaveTimezone}>
      <h2>Часовой пояс</h2>
      <TimezoneSelect
        key={account?.profile?.timezone ?? 'device'}
        name="timezone"
        defaultValue={account?.profile?.timezone || undefined}
        disabled={busy}
      />
      <button className="career-primary-button" disabled={busy}>
        Сохранить часовой пояс
      </button>
    </form>
  );
}

function PasswordChangeForm({
  busy,
  onSavePassword,
}: {
  readonly busy: boolean;
  readonly onSavePassword: (e: React.FormEvent<HTMLFormElement>) => Promise<void>;
}) {
  return (
    <form className="career-account-form" onSubmit={onSavePassword}>
      <h2>Сменить пароль</h2>
      <label>
        <span>Текущий пароль</span>
        <input name="currentPassword" type="password" autoComplete="current-password" required />
      </label>
      <label>
        <span>Новый пароль</span>
        <input
          name="newPassword"
          type="password"
          autoComplete="new-password"
          minLength={MIN_PASSWORD_LENGTH}
          maxLength={256}
          required
        />
      </label>
      <button className="career-primary-button" disabled={busy}>
        Изменить пароль
      </button>
    </form>
  );
}

function SessionsCard({
  account,
  busy,
  onOpenLogoutConfirm,
}: {
  readonly account?: AccountSnapshot;
  readonly busy: boolean;
  readonly onOpenLogoutConfirm: () => void;
}) {
  return (
    <div className="career-account-session-card">
      <strong>Устройства: {account?.sessions.length ?? 1}</strong>
      <p>Завершите входы на других устройствах, если не узнаёте активность.</p>
      <div className="career-account-card-title-wrap">
        <span className="career-account-tag is-ok">Эта сессия</span>
        <span className="career-account-row-desc">Приложение openqareer, этот Mac</span>
      </div>
      <button type="button" disabled={busy} onClick={onOpenLogoutConfirm}>
        Выйти на других устройствах
      </button>
    </div>
  );
}

function AccountSecurityTab({
  account,
  busy,
  onSaveTimezone,
  onSavePassword,
  onOpenLogoutConfirm,
}: {
  readonly account?: AccountSnapshot;
  readonly busy: boolean;
  readonly onSaveTimezone: (e: React.FormEvent<HTMLFormElement>) => Promise<void>;
  readonly onSavePassword: (e: React.FormEvent<HTMLFormElement>) => Promise<void>;
  readonly onOpenLogoutConfirm: () => void;
}) {
  return (
    <div className="career-account-section-stack">
      <TimezoneForm account={account} busy={busy} onSaveTimezone={onSaveTimezone} />
      <PasswordChangeForm busy={busy} onSavePassword={onSavePassword} />
      <SessionsCard account={account} busy={busy} onOpenLogoutConfirm={onOpenLogoutConfirm} />
    </div>
  );
}

function ExportDataCard({
  busy,
  onDownloadExport,
}: {
  readonly busy: boolean;
  readonly onDownloadExport: () => Promise<void>;
}) {
  return (
    <section className="career-account-data-card">
      <DownloadSimple size={21} />
      <div>
        <strong>Экспорт данных</strong>
        <p>Скачайте профиль, память, документы и рыночные направления в JSON.</p>
      </div>
      <button type="button" disabled={busy} onClick={() => void onDownloadExport()}>
        Скачать
      </button>
    </section>
  );
}

function DeleteAccountForm({
  busy,
  onDeleteAccount,
}: {
  readonly busy: boolean;
  readonly onDeleteAccount: (e: React.FormEvent<HTMLFormElement>) => Promise<void>;
}) {
  return (
    <form className="career-account-delete-form" onSubmit={onDeleteAccount}>
      <Trash size={21} />
      <div>
        <strong>Удалить аккаунт и данные</strong>
        <p>
          Это удалит профиль, историю диалога, документы и сохранённые поиски без возможности
          восстановления.
        </p>
      </div>
      <label>
        <span>Введите УДАЛИТЬ</span>
        <input name="confirmation" autoComplete="off" />
      </label>
      <button className="career-danger-button" disabled={busy}>
        Удалить навсегда
      </button>
    </form>
  );
}

function AccountDataTab({
  consents,
  busy,
  onToggleConsent,
  onDownloadExport,
  onOpenDeleteConfirm,
  onDeleteAccount,
}: {
  readonly consents: readonly AccountConsent[];
  readonly busy: boolean;
  readonly onToggleConsent: (c: AccountConsent) => void;
  readonly onDownloadExport: () => Promise<void>;
  readonly onOpenDeleteConfirm: () => void;
  readonly onDeleteAccount: (e: React.FormEvent<HTMLFormElement>) => Promise<void>;
}) {
  return (
    <div className="career-account-section-stack">
      <AccountConsentsSection
        consents={consents}
        onToggleConsent={onToggleConsent}
        onExportAll={() => void onDownloadExport()}
        onDeleteAccount={onOpenDeleteConfirm}
      />
      <ExportDataCard busy={busy} onDownloadExport={onDownloadExport} />
      <DeleteAccountForm busy={busy} onDeleteAccount={onDeleteAccount} />
    </div>
  );
}

interface ModalsHostProps {
  readonly showLogout: boolean;
  readonly showDelete: boolean;
  readonly activeConsent: AccountConsent | null;
  readonly onCloseLogout: () => void;
  readonly onCloseDelete: () => void;
  readonly onCloseConsent: () => void;
  readonly onConfirmConsent: () => void;
  readonly onCloseOtherSessions: () => Promise<void>;
  readonly onDeleteAccount: (e: React.FormEvent<HTMLFormElement>) => Promise<void>;
}

function LogoutConfirmDialog({
  onConfirm,
  onCancel,
}: {
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}) {
  return (
    <AccountConfirmDialog
      title="Выйти на других устройствах?"
      description="Сессии на других браузерах будут завершены, в этой сессии вы останетесь."
      confirmLabel="Выйти"
      isDanger
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}

function DeleteConfirmDialog({
  onConfirm,
  onCancel,
}: {
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}) {
  return (
    <AccountConfirmDialog
      title="Удалить аккаунт?"
      description="Профиль и данные будут удалены безвозвратно через 7 дней."
      confirmLabel="Удалить аккаунт"
      isDanger
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}

function AccountModalsHost(props: ModalsHostProps) {
  const handleLogout = () => {
    props.onCloseLogout();
    void props.onCloseOtherSessions();
  };
  const handleDelete = () => {
    props.onCloseDelete();
    const fakeEvent = {
      preventDefault: () => undefined,
      currentTarget: { elements: { confirmation: { value: 'УДАЛИТЬ' } } },
    } as unknown as React.FormEvent<HTMLFormElement>;
    void props.onDeleteAccount(fakeEvent);
  };

  return (
    <>
      {props.showLogout ? <LogoutConfirmDialog onConfirm={handleLogout} onCancel={props.onCloseLogout} /> : null}
      {props.showDelete ? <DeleteConfirmDialog onConfirm={handleDelete} onCancel={props.onCloseDelete} /> : null}
      {props.activeConsent ? (
        <AccountConfirmDialog
          title={props.activeConsent.date ? 'Отозвать согласие?' : 'Дать согласие?'}
          description={`«${props.activeConsent.title}». ${props.activeConsent.consequences}`}
          confirmLabel={props.activeConsent.date ? 'Отозвать' : 'Дать согласие'}
          isDanger={Boolean(props.activeConsent.date)}
          onConfirm={props.onConfirmConsent}
          onCancel={props.onCloseConsent}
        />
      ) : null}
    </>
  );
}
