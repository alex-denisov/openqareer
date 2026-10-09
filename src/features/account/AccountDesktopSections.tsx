import type { ReactNode } from 'react';
import {
  ArrowsClockwise,
  Briefcase,
  CalendarBlank,
  CheckCircle,
  Clock,
  Desktop,
  DownloadSimple,
  EnvelopeSimple,
  Fingerprint,
  Globe,
  LinkedinLogo,
  LockKey,
  PaperPlaneTilt,
  PencilSimple,
  Receipt,
  ShieldCheck,
  SignIn,
  SlidersHorizontal,
  Trash,
  TrendUp,
  X,
} from '@phosphor-icons/react';
import type {
  AccountAppSettings,
  AccountConsent,
  AccountDevice,
  AccountNotificationEvent,
  AccountPaymentItem,
} from './accountTypes';

interface ProfileSectionProps {
  readonly devices: readonly AccountDevice[];
  readonly onTerminateDevice: (device: AccountDevice) => void;
  readonly onLogoutOtherDevices: () => void;
}

export function AccountProfileSection({
  devices,
  onTerminateDevice,
  onLogoutOtherDevices,
}: ProfileSectionProps) {
  return (
    <div className="career-account-rows">
      <AccountProfileCard />
      <AccountDevicesCard
        devices={devices}
        onTerminateDevice={onTerminateDevice}
        onLogoutOtherDevices={onLogoutOtherDevices}
      />
    </div>
  );
}

function ProfileNameAndEmail() {
  return (
    <>
      <div className="career-account-row">
        <div className="career-account-row-content">
          <span className="career-account-row-label">Имя</span>
          <span className="career-account-row-desc">Андрей Лебедев</span>
        </div>
        <button type="button" className="career-btn is-ghost is-sm">
          <PencilSimple size={16} aria-hidden="true" />
          Изменить
        </button>
      </div>
      <div className="career-account-row">
        <div className="career-account-row-content">
          <span className="career-account-row-label">Почта для входа</span>
          <span className="career-account-row-desc">a.lebedev@example.com</span>
        </div>
        <div className="career-account-row-right">
          <span className="career-account-tag is-ok">
            <CheckCircle size={14} weight="fill" aria-hidden="true" />
            Подтверждена
          </span>
          <button type="button" className="career-btn is-ghost is-sm">
            <PencilSimple size={16} aria-hidden="true" />
            Изменить
          </button>
        </div>
      </div>
    </>
  );
}

function SecurityPasswordAnd2faRows() {
  return (
    <>
      <div className="career-account-row">
        <div className="career-account-row-content">
          <span className="career-account-row-label">Пароль</span>
          <span className="career-account-row-desc">Изменён 12.09</span>
        </div>
        <button type="button" className="career-btn is-sm">
          <LockKey size={16} aria-hidden="true" />
          Сменить пароль
        </button>
      </div>
      <div className="career-account-row">
        <div className="career-account-row-content">
          <span className="career-account-row-label">Двухфакторная защита</span>
          <span className="career-account-row-desc">Код из приложения при входе</span>
        </div>
        <div className="career-account-row-right">
          <span className="career-account-tag is-dim">
            <Clock size={14} aria-hidden="true" />
            Скоро
          </span>
          <button type="button" className="career-btn is-sm" disabled>
            <ShieldCheck size={16} aria-hidden="true" />
            Включить
          </button>
        </div>
      </div>
    </>
  );
}

function SecurityPasskeyAndTimezoneRows() {
  return (
    <>
      <div className="career-account-row">
        <div className="career-account-row-content">
          <span className="career-account-row-label">Ключи доступа (passkeys)</span>
          <span className="career-account-row-desc">Вход по отпечатку или Face ID</span>
        </div>
        <div className="career-account-row-right">
          <span className="career-account-tag is-dim">
            <Clock size={14} aria-hidden="true" />
            Скоро
          </span>
          <button type="button" className="career-btn is-sm" disabled>
            <Fingerprint size={16} aria-hidden="true" />
            Добавить
          </button>
        </div>
      </div>
      <div className="career-account-row">
        <div className="career-account-row-content">
          <span className="career-account-row-label">Часовой пояс</span>
          <span className="career-account-row-desc">Москва, UTC+3</span>
        </div>
        <button type="button" className="career-btn is-ghost is-sm">
          <PencilSimple size={16} aria-hidden="true" />
          Изменить
        </button>
      </div>
    </>
  );
}

function ProfileSecurityRows() {
  return (
    <>
      <SecurityPasswordAnd2faRows />
      <SecurityPasskeyAndTimezoneRows />
    </>
  );
}

function AccountProfileCard() {
  return (
    <section className="career-account-card" aria-labelledby="pr-title">
      <div className="career-account-card-header">
        <h3 id="pr-title" className="career-account-card-title">
          Профиль и вход
        </h3>
      </div>
      <div className="career-account-rows">
        <ProfileNameAndEmail />
        <ProfileSecurityRows />
      </div>
    </section>
  );
}

function DeviceRowItem({
  device,
  onTerminate,
}: {
  readonly device: AccountDevice;
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
        <button type="button" className="career-btn is-sm" onClick={onTerminate}>
          <X size={16} aria-hidden="true" />
          Завершить
        </button>
      )}
    </div>
  );
}

function AccountDevicesCard({
  devices,
  onTerminateDevice,
  onLogoutOtherDevices,
}: ProfileSectionProps) {
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
            onTerminate={() => onTerminateDevice(device)}
          />
        ))}
      </div>
      <div>
        <button type="button" className="career-btn" onClick={onLogoutOtherDevices}>
          <SignIn size={18} aria-hidden="true" />
          Выйти на других устройствах
        </button>
      </div>
    </section>
  );
}

interface ConnectionsSectionProps {
  readonly onManageLinkedIn: () => void;
  readonly onManageHh: () => void;
}

function AccountConnectionRow({
  icon,
  title,
  details,
  tag,
  tagLabel,
  actionLabel,
  onAction,
}: {
  readonly icon: ReactNode;
  readonly title: string;
  readonly details: string;
  readonly tag: 'ok' | 'warn' | 'dim';
  readonly tagLabel: string;
  readonly actionLabel: string;
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
        <button type="button" className="career-btn is-sm" onClick={onAction}>
          {actionLabel === 'Управлять' ? (
            <SlidersHorizontal size={16} aria-hidden="true" />
          ) : null}
          {actionLabel}
        </button>
      </div>
    </div>
  );
}

function PrimaryConnectionsRows({
  onManageLinkedIn,
  onManageHh,
}: ConnectionsSectionProps) {
  return (
    <>
      <AccountConnectionRow
        icon={<LinkedinLogo size={20} />}
        title="LinkedIn"
        details="Подключено 12.09 · вход сохранён до 10.10 · импортировано 9 из 9 мест работы"
        tag="ok"
        tagLabel="Подключено"
        actionLabel="Управлять"
        onAction={onManageLinkedIn}
      />
      <AccountConnectionRow
        icon={<Briefcase size={20} />}
        title="hh.ru"
        details="Подключено 07.10 · импортировано 8 из 9 мест работы"
        tag="warn"
        tagLabel="Частично"
        actionLabel="Управлять"
        onAction={onManageHh}
      />
    </>
  );
}

function SecondaryConnectionsRows() {
  return (
    <>
      <AccountConnectionRow
        icon={<Globe size={20} />}
        title="Другие площадки"
        details="Подключите площадку, и отклики пойдут и туда."
        tag="dim"
        tagLabel="Не подключено"
        actionLabel="Подключить"
      />
      <AccountConnectionRow
        icon={<EnvelopeSimple size={20} />}
        title="Почта"
        details="Нужна, чтобы видеть ответы работодателей."
        tag="dim"
        tagLabel="Не подключено"
        actionLabel="Подключить"
      />
      <AccountConnectionRow
        icon={<CalendarBlank size={20} />}
        title="Календарь"
        details="Нужен, чтобы ставить интервью и напоминания."
        tag="dim"
        tagLabel="Не подключено"
        actionLabel="Подключить"
      />
      <AccountConnectionRow
        icon={<PaperPlaneTilt size={20} />}
        title="Telegram"
        details="Бот @openqareer_bot: напоминания о сроках."
        tag="dim"
        tagLabel="Не подключено"
        actionLabel="Подключить"
      />
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
        <SecondaryConnectionsRows />
      </div>
    </section>
  );
}

interface NotificationsSectionProps {
  readonly events: readonly AccountNotificationEvent[];
  readonly mandatoryEvents: readonly AccountNotificationEvent[];
}

function NotificationsTableRows({
  events,
  mandatoryEvents,
}: NotificationsSectionProps) {
  return (
    <tbody>
      {events.map((e) => (
        <tr key={e.id}>
          <td>
            <strong>{e.title}</strong>
          </td>
          <td className="career-account-table-tc">
            <input type="checkbox" defaultChecked={e.app} aria-label={`${e.title}, приложение`} />
          </td>
          <td className="career-account-table-tc">
            <input type="checkbox" disabled aria-label={`${e.title}, Telegram`} />
          </td>
          <td className="career-account-table-tc">
            <input type="checkbox" defaultChecked={e.email} aria-label={`${e.title}, почта`} />
          </td>
        </tr>
      ))}
      {mandatoryEvents.map((e) => (
        <tr key={e.id}>
          <td>
            <strong>{e.title}</strong>
            <br />
            <span className="career-account-row-desc">{e.mandatoryNote}</span>
          </td>
          <td className="career-account-table-tc">
            <input type="checkbox" checked disabled aria-label={`${e.title}, приложение`} />
          </td>
          <td className="career-account-table-tc">
            <input type="checkbox" disabled aria-label={`${e.title}, Telegram`} />
          </td>
          <td className="career-account-table-tc">
            <input type="checkbox" checked disabled aria-label={`${e.title}, почта`} />
          </td>
        </tr>
      ))}
    </tbody>
  );
}

export function AccountNotificationsSection({
  events,
  mandatoryEvents,
}: NotificationsSectionProps) {
  return (
    <section className="career-account-card" aria-labelledby="notif-title">
      <div className="career-account-card-header">
        <h3 id="notif-title" className="career-account-card-title">
          Уведомления
        </h3>
      </div>
      <div className="career-account-table-wrap">
        <table className="career-account-table">
          <thead>
            <tr>
              <th>Событие</th>
              <th className="career-account-table-tc">Приложение</th>
              <th className="career-account-table-tc">Telegram</th>
              <th className="career-account-table-tc">Почта</th>
            </tr>
          </thead>
          <NotificationsTableRows events={events} mandatoryEvents={mandatoryEvents} />
        </table>
      </div>
      <p className="career-account-row-desc">
        Столбец Telegram недоступен, пока бот не подключён (вкладка «Подключения»).
      </p>
      <div className="career-account-row">
        <div className="career-account-row-content">
          <span className="career-account-row-label">Не беспокоить</span>
          <span className="career-account-row-desc">
            Ночью 22:00-08:00 уведомления копятся и приходят утром
          </span>
        </div>
        <button type="button" className="career-btn is-ghost is-sm">
          <PencilSimple size={16} aria-hidden="true" />
          Изменить
        </button>
      </div>
    </section>
  );
}

interface ConsentsSectionProps {
  readonly consents: readonly AccountConsent[];
  readonly onToggleConsent: (consent: AccountConsent) => void;
  readonly onExportAll: () => void;
  readonly onDeleteAccount: () => void;
}

function ConsentsListCard({
  consents,
  onToggleConsent,
}: Pick<ConsentsSectionProps, 'consents' | 'onToggleConsent'>) {
  return (
    <section className="career-account-card" aria-labelledby="cons-title">
      <div className="career-account-card-header">
        <h3 id="cons-title" className="career-account-card-title">
          Согласия
        </h3>
      </div>
      <div className="career-account-rows">
        {consents.map((item) => (
          <div key={item.id} className="career-account-row">
            <div className="career-account-row-content">
              <span className="career-account-row-label">{item.title}</span>
              <span className="career-account-row-desc">{item.description}</span>
            </div>
            <div className="career-account-row-right">
              <span className={`career-account-tag is-${item.date ? 'ok' : 'dim'}`}>
                {item.date ? `Дано ${item.date}` : 'Не дано'}
              </span>
              <button
                type="button"
                className="career-btn is-sm"
                onClick={() => onToggleConsent(item)}
              >
                {item.date ? 'Отозвать' : 'Дать согласие'}
              </button>
            </div>
          </div>
        ))}
      </div>
      <p className="career-account-row-desc">
        Отзыв останавливает связанную функцию. Уже отправленное остаётся в журнале.
      </p>
    </section>
  );
}

function DataManagementCard({
  onExportAll,
  onDeleteAccount,
}: Pick<ConsentsSectionProps, 'onExportAll' | 'onDeleteAccount'>) {
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
          <button type="button" className="career-btn is-sm" onClick={onExportAll}>
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
          <button type="button" className="career-btn is-danger is-sm" onClick={onDeleteAccount}>
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
}: ConsentsSectionProps) {
  return (
    <div className="career-account-rows">
      <ConsentsListCard consents={consents} onToggleConsent={onToggleConsent} />
      <DataManagementCard onExportAll={onExportAll} onDeleteAccount={onDeleteAccount} />
    </div>
  );
}

function AppTogglesList({ settings }: { readonly settings: AccountAppSettings }) {
  return (
    <>
      <label htmlFor="app-autoupdate-chk" className="career-account-row">
        <div className="career-account-row-content">
          <span className="career-account-row-label">Автообновление</span>
          <span className="career-account-row-desc">
            Новые версии ставятся после перезапуска
          </span>
        </div>
        <input
          id="app-autoupdate-chk"
          type="checkbox"
          defaultChecked={settings.autoUpdate}
          aria-label="Автообновление"
        />
      </label>
      <label htmlFor="app-menubar-chk" className="career-account-row">
        <div className="career-account-row-content">
          <span className="career-account-row-label">Значок в строке меню</span>
          <span className="career-account-row-desc">
            Управление очередью откликов без открытия окна
          </span>
        </div>
        <input
          id="app-menubar-chk"
          type="checkbox"
          defaultChecked={settings.menuBar}
          aria-label="Значок в строке меню"
        />
      </label>
      <label htmlFor="app-launch-chk" className="career-account-row">
        <div className="career-account-row-content">
          <span className="career-account-row-label">Запуск при входе в систему</span>
          <span className="career-account-row-desc">Приложение стартует свёрнутым</span>
        </div>
        <input
          id="app-launch-chk"
          type="checkbox"
          defaultChecked={settings.launchAtLogin}
          aria-label="Запуск при входе в систему"
        />
      </label>
    </>
  );
}

export function AccountAppSettingsSection({
  settings,
}: {
  readonly settings: AccountAppSettings;
}) {
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
            <span className="career-account-row-desc">
              {settings.version}, проверено {settings.checkDate}: обновлений нет
            </span>
          </div>
          <button type="button" className="career-btn is-sm">
            <ArrowsClockwise size={16} aria-hidden="true" />
            Проверить обновления
          </button>
        </div>
        <AppTogglesList settings={settings} />
      </div>
    </section>
  );
}

interface SubscriptionSectionProps {
  readonly isPro: boolean;
  readonly payments: readonly AccountPaymentItem[];
  readonly onOpenTariffs?: () => void;
}

function FreeSubscriptionCard({ onOpenTariffs }: { readonly onOpenTariffs?: () => void }) {
  return (
    <section className="career-account-card" aria-labelledby="pay-title">
      <div className="career-account-card-header">
        <div className="career-account-card-title-wrap">
          <h3 id="pay-title" className="career-account-card-title">
            Подписка и платежи
          </h3>
          <span className="career-account-tag is-ok">Free</span>
        </div>
      </div>
      <div className="career-account-rows">
        <div className="career-account-row">
          <div className="career-account-row-content">
            <span className="career-account-row-label">Тариф</span>
            <span className="career-account-row-desc">Free, без срока и без оплаты</span>
          </div>
          <button type="button" className="career-btn is-sm" onClick={onOpenTariffs}>
            <TrendUp size={16} aria-hidden="true" />
            Выбрать тариф
          </button>
        </div>
      </div>
      <p className="career-account-row-desc">
        Платежей пока нет. После оформления подписки здесь появятся история платежей с чеками.
      </p>
    </section>
  );
}

function PaymentsTable({ payments }: { readonly payments: readonly AccountPaymentItem[] }) {
  return (
    <div className="career-account-table-wrap">
      <table className="career-account-table">
        <thead>
          <tr>
            <th>Дата</th>
            <th>Что оплачено</th>
            <th>Сумма</th>
            <th>Способ</th>
            <th>Чек</th>
          </tr>
        </thead>
        <tbody>
          {payments.map((p) => (
            <tr key={p.date + p.title}>
              <td className="career-account-num">{p.date}</td>
              <td>{p.title}</td>
              <td className="career-account-num">{p.amount}</td>
              <td>{p.method}</td>
              <td>
                <button type="button" className="career-btn is-ghost is-sm">
                  <Receipt size={16} aria-hidden="true" />
                  Чек
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ProSubscriptionCard({
  payments,
  onOpenTariffs,
}: {
  readonly payments: readonly AccountPaymentItem[];
  readonly onOpenTariffs?: () => void;
}) {
  return (
    <section className="career-account-card" aria-labelledby="pay-title">
      <div className="career-account-card-header">
        <div className="career-account-card-title-wrap">
          <h3 id="pay-title" className="career-account-card-title">
            Подписка и платежи
          </h3>
          <span className="career-account-tag is-ok">Pro</span>
        </div>
      </div>
      <div className="career-account-rows">
        <div className="career-account-row">
          <div className="career-account-row-content">
            <span className="career-account-row-label">Тариф</span>
            <span className="career-account-row-desc">Pro, 9 900 ₽ в месяц, действует до 08.11</span>
          </div>
          <button type="button" className="career-btn is-sm" onClick={onOpenTariffs}>
            <TrendUp size={16} aria-hidden="true" />
            Сменить тариф
          </button>
        </div>
        <div className="career-account-row">
          <div className="career-account-row-content">
            <span className="career-account-row-label">Автопродление</span>
            <span className="career-account-row-desc">Включено, спишем 08.11</span>
          </div>
          <button type="button" className="career-btn is-ghost is-sm">
            Отключить автопродление
          </button>
        </div>
      </div>
      <h4 className="career-account-card-title">История платежей</h4>
      <PaymentsTable payments={payments} />
    </section>
  );
}

export function AccountSubscriptionSection({
  isPro,
  payments,
  onOpenTariffs,
}: SubscriptionSectionProps) {
  if (!isPro) {
    return <FreeSubscriptionCard onOpenTariffs={onOpenTariffs} />;
  }
  return <ProSubscriptionCard payments={payments} onOpenTariffs={onOpenTariffs} />;
}
