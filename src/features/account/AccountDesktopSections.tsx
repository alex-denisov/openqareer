import type { ReactNode } from 'react';
import {
  Briefcase,
  CheckCircle,
  Desktop,
  DownloadSimple,
  EnvelopeSimple,
  Globe,
  LinkedinLogo,
  LockKey,
  PaperPlaneTilt,
  PencilSimple,
  SignIn,
  SlidersHorizontal,
  Trash,
  X,
} from '@phosphor-icons/react';
import type { AccountAppSettings, AccountConsent, AccountDevice } from './accountTypes';
import type { CandidateConnection } from '../coach/coachApi';

interface ProfileSectionProps {
  readonly displayName: string | null;
  readonly email: string | null;
  readonly emailVerified?: boolean;
  readonly timezone: string | null;
  readonly devices: readonly AccountDevice[];
  readonly busy: boolean;
  readonly onEditName: () => void;
  readonly onEditEmail: () => void;
  readonly onChangePassword: () => void;
  readonly onEditTimezone: () => void;
  readonly onTerminateDevice: (device: AccountDevice) => void;
  readonly onLogoutOtherDevices: () => void;
  readonly onSignOut: () => void;
}

export function AccountProfileSection({
  displayName,
  email,
  emailVerified,
  timezone,
  devices,
  busy,
  onEditName,
  onEditEmail,
  onChangePassword,
  onEditTimezone,
  onTerminateDevice,
  onLogoutOtherDevices,
  onSignOut,
}: ProfileSectionProps) {
  return (
    <div className="career-account-rows">
      <AccountProfileCard
        displayName={displayName}
        email={email}
        emailVerified={emailVerified}
        timezone={timezone}
        busy={busy}
        onEditName={onEditName}
        onEditEmail={onEditEmail}
        onChangePassword={onChangePassword}
        onEditTimezone={onEditTimezone}
      />
      <AccountDevicesCard
        devices={devices}
        busy={busy}
        onTerminateDevice={onTerminateDevice}
        onLogoutOtherDevices={onLogoutOtherDevices}
        onSignOut={onSignOut}
      />
    </div>
  );
}

function ProfileNameAndEmail({
  displayName,
  email,
  emailVerified,
  busy,
  onEditName,
  onEditEmail,
}: Pick<
  ProfileSectionProps,
  'displayName' | 'email' | 'emailVerified' | 'busy' | 'onEditName' | 'onEditEmail'
>) {
  const emailStatus =
    emailVerified === true ? 'Подтверждена' : emailVerified === false ? 'Не подтверждена' : 'Статус не проверен';
  return (
    <>
      <div className="career-account-row">
        <div className="career-account-row-content">
          <span className="career-account-row-label">Имя</span>
          <span className="career-account-row-desc">{displayName || 'Не указано'}</span>
        </div>
        <button type="button" className="career-btn is-ghost is-sm" disabled={busy} onClick={onEditName}>
          <PencilSimple size={16} aria-hidden="true" />
          Изменить
        </button>
      </div>
      <div className="career-account-row">
        <div className="career-account-row-content">
          <span className="career-account-row-label">Почта для входа</span>
          <span className="career-account-row-desc">{email || 'Не указана'}</span>
        </div>
        <div className="career-account-row-right">
          <span className={`career-account-tag ${emailVerified === true ? 'is-ok' : 'is-dim'}`}>
            {emailVerified === true ? <CheckCircle size={14} weight="fill" aria-hidden="true" /> : null}
            {emailStatus}
          </span>
          <button type="button" className="career-btn is-ghost is-sm" disabled={busy} onClick={onEditEmail}>
            <PencilSimple size={16} aria-hidden="true" />
            Изменить
          </button>
        </div>
      </div>
    </>
  );
}

function SecurityPasswordAnd2faRows({
  busy,
  onChangePassword,
}: Pick<ProfileSectionProps, 'busy' | 'onChangePassword'>) {
  return (
    <>
      <div className="career-account-row">
        <div className="career-account-row-content">
          <span className="career-account-row-label">Пароль</span>
          <span className="career-account-row-desc">Можно сменить в любое время</span>
        </div>
        <button type="button" className="career-btn is-sm" disabled={busy} onClick={onChangePassword}>
          <LockKey size={16} aria-hidden="true" />
          Сменить пароль
        </button>
      </div>
    </>
  );
}

function SecurityPasskeyAndTimezoneRows({
  timezone,
  busy,
  onEditTimezone,
}: Pick<ProfileSectionProps, 'timezone' | 'busy' | 'onEditTimezone'>) {
  return (
    <>
      <div className="career-account-row">
        <div className="career-account-row-content">
          <span className="career-account-row-label">Часовой пояс</span>
          <span className="career-account-row-desc">{timezone || 'Не указан'}</span>
        </div>
        <button type="button" className="career-btn is-ghost is-sm" disabled={busy} onClick={onEditTimezone}>
          <PencilSimple size={16} aria-hidden="true" />
          Изменить
        </button>
      </div>
    </>
  );
}

function ProfileSecurityRows({
  timezone,
  busy,
  onChangePassword,
  onEditTimezone,
}: Pick<ProfileSectionProps, 'timezone' | 'busy' | 'onChangePassword' | 'onEditTimezone'>) {
  return (
    <>
      <SecurityPasswordAnd2faRows busy={busy} onChangePassword={onChangePassword} />
      <SecurityPasskeyAndTimezoneRows
        timezone={timezone}
        busy={busy}
        onEditTimezone={onEditTimezone}
      />
    </>
  );
}

function AccountProfileCard({
  displayName,
  email,
  emailVerified,
  timezone,
  busy,
  onEditName,
  onEditEmail,
  onChangePassword,
  onEditTimezone,
}: Pick<
  ProfileSectionProps,
  | 'displayName'
  | 'email'
  | 'emailVerified'
  | 'timezone'
  | 'busy'
  | 'onEditName'
  | 'onEditEmail'
  | 'onChangePassword'
  | 'onEditTimezone'
>) {
  return (
    <section className="career-account-card" aria-labelledby="pr-title">
      <div className="career-account-card-header">
        <h3 id="pr-title" className="career-account-card-title">
          Профиль и вход
        </h3>
      </div>
      <div className="career-account-rows">
        <ProfileNameAndEmail
          displayName={displayName}
          email={email}
          emailVerified={emailVerified}
          busy={busy}
          onEditName={onEditName}
          onEditEmail={onEditEmail}
        />
        <ProfileSecurityRows
          timezone={timezone}
          busy={busy}
          onChangePassword={onChangePassword}
          onEditTimezone={onEditTimezone}
        />
      </div>
    </section>
  );
}

function DeviceRowItem({
  device,
  busy,
  onTerminate,
}: {
  readonly device: AccountDevice;
  readonly busy: boolean;
  readonly onTerminate: () => void;
}) {
  return (
    <div className="career-account-row">
      <div className="career-account-row-left">
        <span className="career-account-row-icon" aria-hidden="true">
          {device.kind === 'desktop' ? <Desktop size={20} /> : <Globe size={20} />}
        </span>
        <div className="career-account-row-content">
          <span className="career-account-row-label">{device.name}</span>
          <span className="career-account-row-desc">{device.details}</span>
        </div>
      </div>
      {device.current ? (
        <span className="career-account-tag is-ok">
          <CheckCircle size={14} weight="fill" aria-hidden="true" />
          Эта сессия
        </span>
      ) : (
        <button type="button" className="career-btn is-sm" disabled={busy} onClick={onTerminate}>
          <X size={16} aria-hidden="true" />
          Завершить
        </button>
      )}
    </div>
  );
}

function AccountDevicesCard({
  devices,
  busy,
  onTerminateDevice,
  onLogoutOtherDevices,
  onSignOut,
}: Pick<
  ProfileSectionProps,
  'devices' | 'busy' | 'onTerminateDevice' | 'onLogoutOtherDevices' | 'onSignOut'
>) {
  return (
    <section className="career-account-card" aria-labelledby="dev-title">
      <div className="career-account-card-header">
        <div className="career-account-card-title-wrap">
          <h3 id="dev-title" className="career-account-card-title">
            Входы и устройства
          </h3>
          <span className="career-account-tab-badge">{devices.length}</span>
        </div>
        <span className="career-account-row-desc">
          Сессии считаются по устройству, а не по каждому входу.
        </span>
      </div>
      <div className="career-account-rows">
        {devices.map((device) => (
          <DeviceRowItem
            key={device.id}
            device={device}
            busy={busy}
            onTerminate={() => onTerminateDevice(device)}
          />
        ))}
      </div>
      <div>
        <button
          type="button"
          className="career-btn"
          disabled={busy || devices.every((device) => device.current)}
          onClick={onLogoutOtherDevices}
        >
          <SignIn size={18} aria-hidden="true" />
          Выйти на других устройствах
        </button>
        <button type="button" className="career-btn is-ghost is-sm" disabled={busy} onClick={onSignOut}>
          Выйти из аккаунта
        </button>
      </div>
    </section>
  );
}

interface ConnectionsSectionProps {
  readonly connections: readonly CandidateConnection[];
  readonly isLoading: boolean;
  readonly busyPlatform?: 'linkedin' | 'hh';
  readonly notice?: string;
  readonly emailVerified?: boolean;
  readonly emailAvailable: boolean;
  readonly telegramAvailable: boolean;
  readonly telegramConnected: boolean;
  readonly isDesktopApp: boolean;
  readonly onManageLinkedIn: () => void;
  readonly onManageHh: () => void;
  readonly onConnectLinkedIn: () => void;
  readonly onConnectHh: () => void;
  readonly onOpenNotifications: () => void;
  readonly onConnectTelegram: () => void;
}

function AccountConnectionRow({
  icon,
  title,
  details,
  tag,
  tagLabel,
  actionLabel,
  disabled = false,
  onAction,
}: {
  readonly icon: ReactNode;
  readonly title: string;
  readonly details: string;
  readonly tag: 'ok' | 'warn' | 'dim';
  readonly tagLabel: string;
  readonly actionLabel?: string;
  readonly disabled?: boolean;
  readonly onAction?: () => void;
}) {
  return (
    <div className="career-account-row">
      <div className="career-account-row-left">
        <span className="career-account-row-icon" aria-hidden="true">
          {icon}
        </span>
        <div className="career-account-row-content">
          <span className="career-account-row-label">{title}</span>
          <span className="career-account-row-desc">{details}</span>
        </div>
      </div>
      <div className="career-account-row-right">
        <span className={`career-account-tag is-${tag}`}>{tagLabel}</span>
        {actionLabel ? (
          <button type="button" className="career-btn is-sm" disabled={disabled} onClick={onAction}>
            {actionLabel === 'Управлять' ? <SlidersHorizontal size={16} aria-hidden="true" /> : null}
            {actionLabel}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function connectionDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'дата неизвестна';
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit' }).format(date);
}

function connectionState(connection?: CandidateConnection, loading = false) {
  if (!connection) {
    return {
      tag: 'dim' as const,
      label: loading ? 'Проверяем' : 'Нет проверенных данных',
      details: loading ? 'Проверяем состояние подключения.' : 'Состояние подключения не удалось загрузить.',
      connected: false,
      disabled: true,
    };
  }
  if (connection.status === 'connected') {
    return {
      tag: 'ok' as const,
      label: 'Подключено',
      details: `Импортировано ${connection.factCount} фактов · ${connectionDate(connection.lastImportedAt)}`,
      connected: true,
      disabled: false,
    };
  }
  if (connection.status === 'imported') {
    return {
      tag: 'warn' as const,
      label: 'Импортирован профиль',
      details: `Последний импорт ${connectionDate(connection.importedAt)}. Активная сессия не сохранена.`,
      connected: false,
      disabled: false,
    };
  }
  return {
    tag: 'dim' as const,
    label: 'Не подключено',
    details: connection.available
      ? 'Можно подключить из приложения.'
      : 'Доступность площадки не подтверждена. Вход откроется без гарантии импорта.',
    connected: false,
    disabled: false,
  };
}

function PrimaryConnectionsRows(props: ConnectionsSectionProps) {
  const linkedin = props.connections.find((connection) => connection.platform === 'linkedin');
  const hh = props.connections.find((connection) => connection.platform === 'hh');
  const linkedinState = connectionState(linkedin, props.isLoading);
  const hhState = connectionState(hh, props.isLoading);
  return (
    <>
      <AccountConnectionRow
        icon={<LinkedinLogo size={20} />}
        title="LinkedIn"
        details={linkedinState.details}
        tag={linkedinState.tag}
        tagLabel={linkedinState.label}
        actionLabel={linkedinState.connected ? 'Управлять' : props.isDesktopApp ? 'Подключить' : 'Открыть окно входа LinkedIn'}
        disabled={props.isLoading || linkedinState.disabled || props.busyPlatform === 'linkedin'}
        onAction={linkedinState.connected ? props.onManageLinkedIn : props.onConnectLinkedIn}
      />
      <AccountConnectionRow
        icon={<Briefcase size={20} />}
        title="hh.ru"
        details={hhState.details}
        tag={hhState.tag}
        tagLabel={hhState.label}
        actionLabel={hhState.connected ? 'Управлять' : props.isDesktopApp ? 'Подключить' : 'Открыть окно входа hh.ru'}
        disabled={props.isLoading || hhState.disabled || props.busyPlatform === 'hh'}
        onAction={hhState.connected ? props.onManageHh : props.onConnectHh}
      />
    </>
  );
}

function SecondaryConnectionsRows(props: ConnectionsSectionProps) {
  return (
    <>
      <AccountConnectionRow
        icon={<EnvelopeSimple size={20} />}
        title="Почта"
        details={props.emailVerified ? 'Почта для входа подтверждена.' : 'Нужна подтверждённая почта для ответов работодателей.'}
        tag={props.emailVerified ? 'ok' : 'dim'}
        tagLabel={props.emailVerified ? 'Подключено' : 'Не подтверждена'}
        actionLabel={props.emailAvailable ? 'Уведомления' : undefined}
        onAction={props.onOpenNotifications}
      />
      {props.telegramConnected || props.telegramAvailable ? (
        <AccountConnectionRow
          icon={<PaperPlaneTilt size={20} />}
          title="Telegram"
          details={props.telegramConnected
            ? 'Бот @openqareer_bot подключён для выбранных уведомлений.'
            : 'Подключите бота, чтобы получать выбранные уведомления.'}
          tag={props.telegramConnected ? 'ok' : 'dim'}
          tagLabel={props.telegramConnected ? 'Подключено' : 'Не подключено'}
          actionLabel={props.telegramConnected ? 'Уведомления' : 'Подключить'}
          onAction={props.telegramConnected ? props.onOpenNotifications : props.onConnectTelegram}
        />
      ) : null}
    </>
  );
}

export function AccountConnectionsSection(props: ConnectionsSectionProps) {
  return (
    <section className="career-account-card" aria-labelledby="conn-title">
      <div className="career-account-card-header">
        <h3 id="conn-title" className="career-account-card-title">
          Площадки и каналы
        </h3>
      </div>
      <div className="career-account-rows">
        <PrimaryConnectionsRows {...props} />
        <SecondaryConnectionsRows {...props} />
      </div>
      {props.notice ? <p className="career-account-row-desc" role="status">{props.notice}</p> : null}
    </section>
  );
}

interface ConsentsSectionProps {
  readonly consents: readonly AccountConsent[];
  readonly onToggleConsent: (consent: AccountConsent) => void;
  readonly onExportAll: () => void;
  readonly onDeleteAccount: () => void;
  readonly busy?: boolean;
  readonly busyConsentId?: string | null;
  readonly loading?: boolean;
  readonly statusMessage?: string | null;
}

function ConsentsListCard({
  consents,
  busy,
  busyConsentId,
  loading,
  onToggleConsent,
}: Pick<
  ConsentsSectionProps,
  'consents' | 'onToggleConsent' | 'busy' | 'busyConsentId' | 'loading'
>) {
  return (
    <section className="career-account-card" aria-labelledby="cons-title" aria-busy={loading || busy}>
      <div className="career-account-card-header">
        <h3 id="cons-title" className="career-account-card-title">
          Согласия
        </h3>
      </div>
      <div className="career-account-rows">
        {consents.map((item) => (
          <ConsentRow
            key={item.id}
            item={item}
            disabled={Boolean(loading || busy || busyConsentId === item.id)}
            onToggle={() => onToggleConsent(item)}
          />
        ))}
      </div>
      {loading ? <p className="career-account-row-desc">Загружаем актуальный статус согласий.</p> : null}
      <p className="career-account-row-desc">
        Отзыв останавливает связанную функцию. Уже отправленное остаётся в журнале.
      </p>
    </section>
  );
}

function ConsentRow({
  item,
  disabled,
  onToggle,
}: {
  readonly item: AccountConsent;
  readonly disabled: boolean;
  readonly onToggle: () => void;
}) {
  const unavailable = item.status === 'unknown';
  const revoke = item.status === 'granted';
  return (
    <div className="career-account-row">
      <div className="career-account-row-content">
        <span className="career-account-row-label">{item.title}</span>
        <span className="career-account-row-desc">{item.description}</span>
      </div>
      <div className="career-account-row-right">
        <ConsentStatus item={item} />
        {unavailable ? null : (
          <button
            type="button"
            className="career-btn is-sm"
            disabled={disabled || (revoke ? !item.revokeable : !item.grantable)}
            onClick={onToggle}
          >
            {revoke ? 'Отозвать' : 'Дать согласие'}
          </button>
        )}
      </div>
    </div>
  );
}

function ConsentStatus({ item }: { readonly item: AccountConsent }) {
  if (item.status === 'unknown') {
    return <span className="career-account-tag is-dim">Нет проверенных данных</span>;
  }
  if (item.status === 'granted') {
    return <span className="career-account-tag is-ok">Дано {item.date || 'дата неизвестна'}</span>;
  }
  return <span className="career-account-tag is-dim">Не дано</span>;
}

function DataManagementCard({
  busy,
  onExportAll,
  onDeleteAccount,
}: Pick<ConsentsSectionProps, 'onExportAll' | 'onDeleteAccount' | 'busy'>) {
  return (
    <section className="career-account-card" aria-labelledby="data-title">
      <div className="career-account-card-header">
        <h3 id="data-title" className="career-account-card-title">
          Данные
        </h3>
      </div>
      <div className="career-account-rows">
        <div className="career-account-row">
          <div className="career-account-row-content">
            <span className="career-account-row-label">Выгрузить всё</span>
            <span className="career-account-row-desc">
              Архив: профиль, резюме, отклики, журнал. Готовится до 10 минут.
            </span>
          </div>
          <button type="button" className="career-btn is-sm" disabled={busy} onClick={onExportAll}>
            <DownloadSimple size={16} aria-hidden="true" />
            Выгрузить
          </button>
        </div>
        <div className="career-account-row">
          <div className="career-account-row-content">
            <span className="career-account-row-label">Удалить аккаунт</span>
            <span className="career-account-row-desc">
              Профиль и данные удаляются безвозвратно через 7 дней.
            </span>
          </div>
          <button type="button" className="career-btn is-danger is-sm" disabled={busy} onClick={onDeleteAccount}>
            <Trash size={16} aria-hidden="true" />
            Удалить
          </button>
        </div>
      </div>
    </section>
  );
}

export function AccountConsentsSection({
  consents,
  onToggleConsent,
  onExportAll,
  onDeleteAccount,
  busy,
  busyConsentId,
  loading,
  statusMessage,
}: ConsentsSectionProps) {
  return (
    <div className="career-account-rows">
      <ConsentsListCard
        consents={consents}
        onToggleConsent={onToggleConsent}
        busy={busy}
        busyConsentId={busyConsentId}
        loading={loading}
      />
      <DataManagementCard busy={busy} onExportAll={onExportAll} onDeleteAccount={onDeleteAccount} />
      {statusMessage ? <p className="career-account-row-desc" role="status">{statusMessage}</p> : null}
    </div>
  );
}

const APP_TOGGLES = [
  {
    key: 'autoUpdate',
    id: 'app-autoupdate-chk',
    label: 'Автообновление',
    enabledDescription: 'Новые версии ставятся после перезапуска',
  },
  {
    key: 'menuBar',
    id: 'app-menubar-chk',
    label: 'Значок в строке меню',
    enabledDescription: 'Управление очередью откликов без открытия окна',
  },
  {
    key: 'launchAtLogin',
    id: 'app-launch-chk',
    label: 'Запуск при входе в систему',
    enabledDescription: 'Приложение стартует свёрнутым',
  },
] as const;

function AppTogglesList({ settings }: { readonly settings: AccountAppSettings }) {
  return (
    <>
      {APP_TOGGLES.filter((toggle) => settings[toggle.key] !== null).map((toggle) => (
        <AppToggleRow
          key={toggle.key}
          id={toggle.id}
          label={toggle.label}
          checked={settings[toggle.key]}
          enabledDescription={toggle.enabledDescription}
        />
      ))}
    </>
  );
}

function AppToggleRow({
  id,
  label,
  checked,
  enabledDescription,
}: {
  readonly id: string;
  readonly label: string;
  readonly checked: boolean | null;
  readonly enabledDescription: string;
}) {
  return (
    <label htmlFor={id} className="career-account-row">
      <div className="career-account-row-content">
        <span className="career-account-row-label">{label}</span>
        <span className="career-account-row-desc">
          {enabledDescription}
        </span>
      </div>
      <input
        id={id}
        type="checkbox"
        checked={checked ?? false}
        aria-label={label}
        readOnly
      />
    </label>
  );
}

export function AccountAppSettingsSection({ settings }: { readonly settings: AccountAppSettings }) {
  return (
    <section className="career-account-card" aria-labelledby="app-title">
      <div className="career-account-card-header">
        <h3 id="app-title" className="career-account-card-title">
          Приложение
        </h3>
      </div>
      <div className="career-account-rows">
        <div className="career-account-row">
          <div className="career-account-row-content">
            <span className="career-account-row-label">Версия</span>
            <span className="career-account-row-desc">{settings.version}</span>
          </div>
        </div>
        {settings.freshnessLine ? <p className="career-account-row-desc">{settings.freshnessLine}</p> : null}
        <AppTogglesList settings={settings} />
      </div>
    </section>
  );
}
