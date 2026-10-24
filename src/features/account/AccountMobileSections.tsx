import {
  Bell,
  CaretLeft,
  CaretRight,
  LockKey,
  Plugs,
  ShieldCheck,
  SignIn,
  Trash,
  Wallet,
} from '@phosphor-icons/react';
import type {
  AccountConsent,
  AccountDevice,
  MobileAccountViewId,
} from './accountTypes';
import type { CandidateConnection } from '../coach/coachApi';
import { initialsFor } from '../shell/accountIdentity';

interface MobileHomeProps {
  readonly displayName: string | null;
  readonly email: string | null;
  readonly connectionCount?: string | null;
  readonly onGoView: (view: MobileAccountViewId) => void;
  readonly onSignOut: () => void;
}

function MobileHomePrimaryGroup({
  onGoView,
  connectionCount,
}: Pick<MobileHomeProps, 'onGoView' | 'connectionCount'>) {
  return (
    <div className="career-account-mobile-group">
      <button
        type="button"
        className="career-account-mobile-row"
        onClick={() => onGoView('prof')}
      >
        <div className="career-account-row-left">
          <LockKey size={20} className="career-account-row-icon" />
          <div className="career-account-row-content">
            <span className="career-account-row-label">Профиль и вход</span>
            <span className="career-account-row-desc">пароль, защита, устройства</span>
          </div>
        </div>
        <CaretRight size={18} aria-hidden="true" />
      </button>
      <button
        type="button"
        className="career-account-mobile-row"
        onClick={() => onGoView('conn')}
      >
        <div className="career-account-row-left">
          <Plugs size={20} className="career-account-row-icon" />
          <span className="career-account-row-label">Подключения</span>
        </div>
        <div className="career-account-row-right">
          {connectionCount ? <span className="career-account-row-desc">{connectionCount}</span> : null}
          <CaretRight size={18} aria-hidden="true" />
        </div>
      </button>
      <button
        type="button"
        className="career-account-mobile-row"
        onClick={() => onGoView('notif')}
      >
        <div className="career-account-row-left">
          <Bell size={20} className="career-account-row-icon" />
          <span className="career-account-row-label">Уведомления</span>
        </div>
        <CaretRight size={18} aria-hidden="true" />
      </button>
    </div>
  );
}

function MobileHomeSecondaryGroup({ onGoView }: Pick<MobileHomeProps, 'onGoView'>) {
  return (
    <div className="career-account-mobile-group">
      <button
        type="button"
        className="career-account-mobile-row"
        onClick={() => onGoView('cons')}
      >
        <div className="career-account-row-left">
          <ShieldCheck size={20} className="career-account-row-icon" />
          <span className="career-account-row-label">Согласия и данные</span>
        </div>
        <CaretRight size={18} aria-hidden="true" />
      </button>
      <button
        type="button"
        className="career-account-mobile-row"
        onClick={() => onGoView('pay')}
      >
        <div className="career-account-row-left">
          <Wallet size={20} className="career-account-row-icon" />
          <span className="career-account-row-label">Подписка и платежи</span>
        </div>
        <CaretRight size={18} aria-hidden="true" />
      </button>
    </div>
  );
}

function MobileHomeNavGroups({
  onGoView,
  connectionCount,
}: Pick<MobileHomeProps, 'onGoView' | 'connectionCount'>) {
  return (
    <>
      <MobileHomePrimaryGroup onGoView={onGoView} connectionCount={connectionCount} />
      <MobileHomeSecondaryGroup onGoView={onGoView} />
    </>
  );
}

export function MobileAccountHome({
  displayName,
  email,
  connectionCount,
  onGoView,
  onSignOut,
}: MobileHomeProps) {
  return (
    <div className="career-account-mobile-view" data-mv="home">
      <div className="career-account-head">
        <h2 className="career-account-title">Аккаунт</h2>
      </div>
      <button
        type="button"
        className="career-account-mobile-user-card"
        onClick={() => onGoView('prof')}
      >
        <div className="career-account-mobile-user-info">
          <span className="career-account-mobile-avatar" aria-hidden="true">{initialsFor(displayName)}</span>
          <div className="career-account-row-content">
            <span className="career-account-row-label">{displayName || 'Имя не указано'}</span>
            <span className="career-account-row-desc">{email || 'Почта не указана'}</span>
          </div>
        </div>
        <CaretRight size={18} aria-hidden="true" />
      </button>
      <MobileHomeNavGroups onGoView={onGoView} connectionCount={connectionCount} />
      <button type="button" className="career-btn is-ghost" onClick={onSignOut}>
        Выйти из аккаунта
      </button>
    </div>
  );
}

interface MobileProfileProps {
  readonly displayName: string | null;
  readonly email: string | null;
  readonly emailVerified?: boolean;
  readonly timezone: string | null;
  readonly onBack: () => void;
  readonly onGoDevices: () => void;
  readonly onEditName: () => void;
  readonly onEditEmail: () => void;
  readonly onChangePassword: () => void;
  readonly onEditTimezone: () => void;
  readonly onSignOut: () => void;
}

function ProfileIdentityGroup({
  displayName,
  email,
  emailVerified,
  onEditName,
  onEditEmail,
  onChangePassword,
}: Pick<
  MobileProfileProps,
  'displayName' | 'email' | 'emailVerified' | 'onEditName' | 'onEditEmail' | 'onChangePassword'
>) {
  return (
    <div className="career-account-mobile-group">
      <button type="button" className="career-account-mobile-row" onClick={onEditName}>
        <div className="career-account-row-content">
          <span className="career-account-row-label">Имя</span>
          <span className="career-account-row-desc">{displayName || 'Не указано'}</span>
        </div>
        <CaretRight size={18} aria-hidden="true" />
      </button>
      <button type="button" className="career-account-mobile-row" onClick={onEditEmail}>
        <div className="career-account-row-content">
          <span className="career-account-row-label">Почта для входа</span>
          <span className="career-account-row-desc">{email || 'Не указана'}</span>
        </div>
        <div className="career-account-row-right">
          <span className={`career-account-tag is-${emailVerified === true ? 'ok' : 'dim'}`}>
            {emailVerified === true ? 'Подтверждена' : emailVerified === false ? 'Не подтверждена' : 'Статус не проверен'}
          </span>
          <CaretRight size={18} aria-hidden="true" />
        </div>
      </button>
      <button type="button" className="career-account-mobile-row" onClick={onChangePassword}>
        <span className="career-account-row-label">Сменить пароль</span>
        <CaretRight size={18} aria-hidden="true" />
      </button>
    </div>
  );
}

function ProfileSecurityGroup({
  timezone,
  onGoDevices,
  onEditTimezone,
}: Pick<MobileProfileProps, 'timezone' | 'onGoDevices' | 'onEditTimezone'>) {
  return (
    <>
      <div className="career-account-mobile-group">
        <div className="career-account-mobile-row">
          <div className="career-account-row-content">
            <span className="career-account-row-label">Двухфакторная защита</span>
            <span className="career-account-row-desc">код из приложения при входе</span>
          </div>
        </div>
        <div className="career-account-mobile-row">
          <div className="career-account-row-content">
            <span className="career-account-row-label">Ключи доступа</span>
            <span className="career-account-row-desc">вход по отпечатку или Face ID</span>
          </div>
        </div>
      </div>
      <div className="career-account-mobile-group">
        <button type="button" className="career-account-mobile-row" onClick={onEditTimezone}>
          <div className="career-account-row-content">
            <span className="career-account-row-label">Часовой пояс</span>
            <span className="career-account-row-desc">{timezone || 'Не указан'}</span>
          </div>
          <CaretRight size={18} aria-hidden="true" />
        </button>
        <button type="button" className="career-account-mobile-row" onClick={onGoDevices}>
          <span className="career-account-row-label">Входы и устройства</span>
          <div className="career-account-row-right">
            <span className="career-account-num">3</span>
            <CaretRight size={18} aria-hidden="true" />
          </div>
        </button>
      </div>
    </>
  );
}

export function MobileAccountProfile({
  displayName,
  email,
  emailVerified,
  timezone,
  onBack,
  onGoDevices,
  onEditName,
  onEditEmail,
  onChangePassword,
  onEditTimezone,
  onSignOut,
}: MobileProfileProps) {
  return (
    <div className="career-account-mobile-view" data-mv="prof">
      <div className="career-account-mobile-header">
        <button
          type="button"
          className="career-account-mobile-back-btn"
          onClick={onBack}
          aria-label="Назад"
        >
          <CaretLeft size={20} aria-hidden="true" />
        </button>
        <h2 className="career-account-title">Профиль и вход</h2>
      </div>
      <ProfileIdentityGroup
        displayName={displayName}
        email={email}
        emailVerified={emailVerified}
        onEditName={onEditName}
        onEditEmail={onEditEmail}
        onChangePassword={onChangePassword}
      />
      <ProfileSecurityGroup timezone={timezone} onGoDevices={onGoDevices} onEditTimezone={onEditTimezone} />
      <button type="button" className="career-btn is-ghost" onClick={onSignOut}>Выйти из аккаунта</button>
    </div>
  );
}

interface MobileDevicesProps {
  readonly devices: readonly AccountDevice[];
  readonly busy: boolean;
  readonly onBack: () => void;
  readonly onTerminateDevice: (d: AccountDevice) => void;
  readonly onLogoutOtherDevices: () => void;
}

function MobileDeviceRow({
  device,
  busy,
  onTerminate,
}: {
  readonly device: AccountDevice;
  readonly busy: boolean;
  readonly onTerminate: () => void;
}) {
  return (
    <div className="career-account-mobile-row">
      <div className="career-account-row-content">
        <span className="career-account-row-label">{device.name}</span>
        <span className="career-account-row-desc">{device.details}</span>
      </div>
      {device.current ? (
        <span className="career-account-tag is-ok">Эта сессия</span>
      ) : (
        <button type="button" className="career-btn is-sm" disabled={busy} onClick={onTerminate}>
          Завершить
        </button>
      )}
    </div>
  );
}

export function MobileAccountDevices({
  devices,
  busy,
  onBack,
  onTerminateDevice,
  onLogoutOtherDevices,
}: MobileDevicesProps) {
  return (
    <div className="career-account-mobile-view" data-mv="dev">
      <div className="career-account-mobile-header">
        <button
          type="button"
          className="career-account-mobile-back-btn"
          onClick={onBack}
          aria-label="Назад"
        >
          <CaretLeft size={20} aria-hidden="true" />
        </button>
        <h2 className="career-account-title">Входы и устройства</h2>
      </div>
      <p className="career-account-lead">Сессии считаются по устройству.</p>
      <div className="career-account-mobile-group">
        {devices.map((device) => (
          <MobileDeviceRow
            key={device.id}
            device={device}
            busy={busy}
            onTerminate={() => onTerminateDevice(device)}
          />
        ))}
      </div>
      <button
        type="button"
        className="career-account-mobile-danger-btn"
        disabled={busy || devices.every((device) => device.current)}
        onClick={onLogoutOtherDevices}
      >
        <SignIn size={18} aria-hidden="true" />
        Выйти на других устройствах
      </button>
    </div>
  );
}

interface MobileConnectionsProps {
  readonly connections: readonly CandidateConnection[];
  readonly isLoading: boolean;
  readonly notice?: string;
  readonly emailVerified?: boolean;
  readonly emailAvailable: boolean;
  readonly telegramAvailable: boolean;
  readonly telegramConnected: boolean;
  readonly onBack: () => void;
  readonly onGoLinkedIn?: () => void;
  readonly onGoHh?: () => void;
  readonly onOpenNotifications: () => void;
}

function ConnectedPlatformsGroup({
  connections,
  isLoading,
  onGoLinkedIn,
  onGoHh,
}: Pick<MobileConnectionsProps, 'connections' | 'isLoading' | 'onGoLinkedIn' | 'onGoHh'>) {
  const linkedin = connections.find((connection) => connection.platform === 'linkedin');
  const hh = connections.find((connection) => connection.platform === 'hh');
  return (
    <div className="career-account-mobile-group">
      <PlatformRow label="LinkedIn" connection={linkedin} isLoading={isLoading} onGo={onGoLinkedIn} />
      <PlatformRow label="hh.ru" connection={hh} isLoading={isLoading} onGo={onGoHh} />
    </div>
  );
}

/** Without a handler the row only reports the state: no chevron to a path that cannot finish (B464). */
function PlatformRow({
  label,
  connection,
  isLoading,
  onGo,
}: {
  readonly label: string;
  readonly connection: CandidateConnection | undefined;
  readonly isLoading: boolean;
  readonly onGo?: () => void;
}) {
  const content = (
    <>
      <div className="career-account-row-content">
        <span className="career-account-row-label">{label}</span>
        <span className="career-account-row-desc">{mobileConnectionDetails(connection, isLoading)}</span>
      </div>
      <div className="career-account-row-right">
        <span className={`career-account-tag is-${mobileConnectionTag(connection, isLoading)}`}>
          {mobileConnectionStatus(connection, isLoading)}
        </span>
        {onGo ? <CaretRight size={18} aria-hidden="true" /> : null}
      </div>
    </>
  );
  return onGo ? (
    <button type="button" className="career-account-mobile-row" disabled={isLoading} onClick={onGo}>
      {content}
    </button>
  ) : (
    <div className="career-account-mobile-row">{content}</div>
  );
}

function mobileConnectionDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'дата неизвестна';
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit' }).format(date);
}

function mobileConnectionStatus(connection: CandidateConnection | undefined, loading: boolean): string {
  if (!connection) return loading ? 'Проверяем' : 'Нет данных';
  if (connection.status === 'connected') return 'Подключено';
  if (connection.status === 'imported') return 'Профиль импортирован';
  return 'Не подключено';
}

function mobileConnectionTag(connection: CandidateConnection | undefined, loading: boolean): 'ok' | 'warn' | 'dim' {
  if (!connection || connection.status === 'disconnected') return 'dim';
  if (connection.status === 'imported') return 'warn';
  return loading ? 'dim' : 'ok';
}

function mobileConnectionDetails(connection: CandidateConnection | undefined, loading: boolean): string {
  if (!connection) return loading ? 'Проверяем состояние подключения.' : 'Состояние не удалось загрузить.';
  if (connection.status === 'connected') {
    return connection.factCount === 0
      ? `Подключено без импорта · ${mobileConnectionDate(connection.lastImportedAt)}`
      : `Импортировано ${connection.factCount} фактов · ${mobileConnectionDate(connection.lastImportedAt)}`;
  }
  if (connection.status === 'imported') {
    return `Профиль импортирован ${mobileConnectionDate(connection.importedAt)}. Активная сессия не сохранена.`;
  }
  return 'Подключите площадку из приложения.';
}

function ChannelsGroup({
  emailVerified,
  emailAvailable,
  telegramConnected,
  onOpenNotifications,
}: Pick<
  MobileConnectionsProps,
  'emailVerified' | 'emailAvailable' | 'telegramConnected' | 'onOpenNotifications'
>) {
  return (
    <div className="career-account-mobile-group">
      <EmailChannelRow
        emailVerified={emailVerified}
        emailAvailable={emailAvailable}
        onOpen={onOpenNotifications}
      />
      <TelegramChannelRow
        connected={telegramConnected}
        onOpen={onOpenNotifications}
      />
    </div>
  );
}

function EmailChannelRow({
  emailVerified,
  emailAvailable,
  onOpen,
}: Pick<MobileConnectionsProps, 'emailVerified' | 'emailAvailable'> & { readonly onOpen: () => void }) {
  const status = emailVerified ? (emailAvailable ? 'Подключено' : 'Подтверждена') : 'Не подтверждена';
  const description = emailVerified
    ? emailAvailable
      ? 'Почта для входа подтверждена. Канал уведомлений доступен.'
      : 'Почта подтверждена, но канал уведомлений недоступен.'
    : 'Для ответов работодателей нужна подтверждённая почта.';
  return (
    <button type="button" className="career-account-mobile-row" onClick={onOpen}>
      <ChannelRowContent title="Почта" description={description} />
      <ChannelRowAction status={status} connected={Boolean(emailVerified && emailAvailable)} />
    </button>
  );
}

function TelegramChannelRow({
  connected,
  onOpen,
}: {
  readonly connected: boolean;
  readonly onOpen: () => void;
}) {
  const description = connected
    ? 'Бот @openqareer_bot подключён для выбранных уведомлений.'
    : 'Настройте связь и уведомления в разделе «Уведомления».';
  return (
    <button type="button" className="career-account-mobile-row" onClick={onOpen}>
      <ChannelRowContent title="Telegram" description={description} />
      <ChannelRowAction status={connected ? 'Подключено' : 'Не подключено'} connected={connected} />
    </button>
  );
}

function ChannelRowContent({ title, description }: { readonly title: string; readonly description: string }) {
  return (
    <div className="career-account-row-content">
      <span className="career-account-row-label">{title}</span>
      <span className="career-account-row-desc">{description}</span>
    </div>
  );
}

function ChannelRowAction({ status, connected }: { readonly status: string; readonly connected: boolean }) {
  return (
    <div className="career-account-row-right">
      <span className={`career-account-tag is-${connected ? 'ok' : 'dim'}`}>{status}</span>
      <CaretRight size={18} aria-hidden="true" />
    </div>
  );
}

export function MobileAccountConnections({
  connections,
  isLoading,
  notice,
  emailVerified,
  emailAvailable,
  telegramConnected,
  onBack,
  onGoLinkedIn,
  onGoHh,
  onOpenNotifications,
}: MobileConnectionsProps) {
  return (
    <div className="career-account-mobile-view" data-mv="conn">
      <div className="career-account-mobile-header">
        <button
          type="button"
          className="career-account-mobile-back-btn"
          onClick={onBack}
          aria-label="Назад"
        >
          <CaretLeft size={20} aria-hidden="true" />
        </button>
        <h2 className="career-account-title">Подключения</h2>
      </div>
      <ConnectedPlatformsGroup
        connections={connections}
        isLoading={isLoading}
        onGoLinkedIn={onGoLinkedIn}
        onGoHh={onGoHh}
      />
      <ChannelsGroup
        emailVerified={emailVerified}
        emailAvailable={emailAvailable}
        telegramConnected={telegramConnected}
        onOpenNotifications={onOpenNotifications}
      />
      {notice ? <p className="career-account-row-desc" role="status">{notice}</p> : null}
    </div>
  );
}

interface MobileConsentsProps {
  readonly consents: readonly AccountConsent[];
  readonly loading: boolean;
  readonly busyConsentId?: string | null;
  readonly statusMessage?: string | null;
  readonly onBack: () => void;
  readonly onToggleConsent: (c: AccountConsent) => void;
  readonly onExportAll: () => void;
  readonly onDeleteAccount: () => void;
}

export function MobileAccountConsents({
  consents,
  loading,
  busyConsentId,
  statusMessage,
  onBack,
  onToggleConsent,
  onExportAll,
  onDeleteAccount,
}: MobileConsentsProps) {
  return (
    <div className="career-account-mobile-view" data-mv="cons">
      <MobileSectionHeader title="Согласия и данные" onBack={onBack} />
      <p className="career-account-lead">Статусы загружаются из настроек аккаунта.</p>
      {loading ? <p role="status">Загружаем актуальный статус согласий.</p> : null}
      <MobileConsentRows
        consents={consents}
        loading={loading}
        busyConsentId={busyConsentId}
        onToggleConsent={onToggleConsent}
      />
      {statusMessage ? <p role="status">{statusMessage}</p> : null}
      <MobileConsentActions onExportAll={onExportAll} onDeleteAccount={onDeleteAccount} />
    </div>
  );
}

function MobileSectionHeader({ title, onBack }: { readonly title: string; readonly onBack: () => void }) {
  return (
    <div className="career-account-mobile-header">
      <button type="button" className="career-account-mobile-back-btn" onClick={onBack} aria-label="Назад">
        <CaretLeft size={20} aria-hidden="true" />
      </button>
      <h2 className="career-account-title">{title}</h2>
    </div>
  );
}

function MobileConsentRows({
  consents,
  loading,
  busyConsentId,
  onToggleConsent,
}: Pick<MobileConsentsProps, 'consents' | 'loading' | 'busyConsentId' | 'onToggleConsent'>) {
  return (
    <div className="career-account-mobile-group">
      {consents.map((item) => (
        <MobileConsentRow
          key={item.id}
          item={item}
          disabled={Boolean(loading || busyConsentId === item.id)}
          onToggle={() => onToggleConsent(item)}
        />
      ))}
    </div>
  );
}

function MobileConsentRow({
  item,
  disabled,
  onToggle,
}: {
  readonly item: AccountConsent;
  readonly disabled: boolean;
  readonly onToggle: () => void;
}) {
  const unknown = item.status === 'unknown';
  const granted = item.status === 'granted';
  const status = unknown ? 'Нет проверенных данных' : granted ? `Дано ${item.date || 'дата неизвестна'}` : 'Не дано';
  return (
    <div className="career-account-mobile-row">
      <div className="career-account-row-content">
        <span className="career-account-row-label">{item.title}</span>
        <span className="career-account-row-desc">{status}</span>
      </div>
      <button
        type="button"
        className="career-btn is-sm"
        disabled={disabled || unknown || (granted ? !item.revokeable : !item.grantable)}
        onClick={onToggle}
      >
        {granted ? 'Отозвать' : 'Дать согласие'}
      </button>
    </div>
  );
}

function MobileConsentActions({
  onExportAll,
  onDeleteAccount,
}: Pick<MobileConsentsProps, 'onExportAll' | 'onDeleteAccount'>) {
  return (
    <>
      <button type="button" className="career-btn" onClick={onExportAll}>Выгрузить данные</button>
      <button type="button" className="career-account-mobile-danger-btn" onClick={onDeleteAccount}>
        <Trash size={18} aria-hidden="true" />
        Удалить аккаунт
      </button>
    </>
  );
}
