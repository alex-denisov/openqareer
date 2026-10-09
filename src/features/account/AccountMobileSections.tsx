import {
  Bell,
  CaretLeft,
  CaretRight,
  LockKey,
  Plugs,
  ShieldCheck,
  SignIn,
  Trash,
  TrendUp,
  Wallet,
  X,
} from '@phosphor-icons/react';
import type {
  AccountConsent,
  AccountDevice,
  AccountNotificationEvent,
  AccountPaymentItem,
  MobileAccountViewId,
} from './accountTypes';

interface MobileHomeProps {
  readonly isPro: boolean;
  readonly onGoView: (view: MobileAccountViewId) => void;
}

function MobileHomePrimaryGroup({ onGoView }: Pick<MobileHomeProps, 'onGoView'>) {
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
          <span className="career-account-row-desc">2 из 6</span>
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

function MobileHomeSecondaryGroup({ isPro, onGoView }: MobileHomeProps) {
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
        <div className="career-account-row-right">
          <span className="career-account-row-desc">{isPro ? 'Pro' : 'Free'}</span>
          <CaretRight size={18} aria-hidden="true" />
        </div>
      </button>
    </div>
  );
}

function MobileHomeNavGroups({ isPro, onGoView }: MobileHomeProps) {
  return (
    <>
      <MobileHomePrimaryGroup onGoView={onGoView} />
      <MobileHomeSecondaryGroup isPro={isPro} onGoView={onGoView} />
    </>
  );
}

export function MobileAccountHome({ isPro, onGoView }: MobileHomeProps) {
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
          <span className="career-account-mobile-avatar">А</span>
          <div className="career-account-row-content">
            <span className="career-account-row-label">Андрей Лебедев</span>
            <span className="career-account-row-desc">a.lebedev@example.com</span>
          </div>
        </div>
        <CaretRight size={18} aria-hidden="true" />
      </button>
      <MobileHomeNavGroups isPro={isPro} onGoView={onGoView} />
    </div>
  );
}

interface MobileProfileProps {
  readonly onBack: () => void;
  readonly onGoDevices: () => void;
}

function ProfileIdentityGroup() {
  return (
    <div className="career-account-mobile-group">
      <div className="career-account-mobile-row">
        <span className="career-account-row-label">Имя</span>
        <span className="career-account-row-desc">Андрей Лебедев</span>
      </div>
      <div className="career-account-mobile-row">
        <div className="career-account-row-content">
          <span className="career-account-row-label">Почта для входа</span>
          <span className="career-account-row-desc">a.lebedev@example.com</span>
        </div>
        <span className="career-account-tag is-ok">Подтверждена</span>
      </div>
      <div className="career-account-mobile-row">
        <span className="career-account-row-label">Пароль</span>
        <span className="career-account-row-desc">Изменён 12.09</span>
      </div>
    </div>
  );
}

function ProfileSecurityGroup({ onGoDevices }: { readonly onGoDevices: () => void }) {
  return (
    <>
      <div className="career-account-mobile-group">
        <div className="career-account-mobile-row">
          <div className="career-account-row-content">
            <span className="career-account-row-label">Двухфакторная защита</span>
            <span className="career-account-row-desc">код из приложения при входе</span>
          </div>
          <span className="career-account-tag is-dim">Скоро</span>
        </div>
        <div className="career-account-mobile-row">
          <div className="career-account-row-content">
            <span className="career-account-row-label">Ключи доступа</span>
            <span className="career-account-row-desc">вход по отпечатку или Face ID</span>
          </div>
          <span className="career-account-tag is-dim">Скоро</span>
        </div>
      </div>
      <div className="career-account-mobile-group">
        <div className="career-account-mobile-row">
          <div className="career-account-row-content">
            <span className="career-account-row-label">Часовой пояс</span>
            <span className="career-account-row-desc">Москва, UTC+3</span>
          </div>
        </div>
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

export function MobileAccountProfile({ onBack, onGoDevices }: MobileProfileProps) {
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
      <ProfileIdentityGroup />
      <ProfileSecurityGroup onGoDevices={onGoDevices} />
    </div>
  );
}

interface MobileDevicesProps {
  readonly devices: readonly AccountDevice[];
  readonly onBack: () => void;
  readonly onTerminateDevice: (d: AccountDevice) => void;
  readonly onLogoutOtherDevices: () => void;
}

function MobileDeviceRow({
  device,
  onTerminate,
}: {
  readonly device: AccountDevice;
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
        <button type="button" className="career-btn is-sm" onClick={onTerminate}>
          Завершить
        </button>
      )}
    </div>
  );
}

export function MobileAccountDevices({
  devices,
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
            onTerminate={() => onTerminateDevice(device)}
          />
        ))}
      </div>
      <button
        type="button"
        className="career-account-mobile-danger-btn"
        onClick={onLogoutOtherDevices}
      >
        <SignIn size={18} aria-hidden="true" />
        Выйти на других устройствах
      </button>
    </div>
  );
}

interface MobileConnectionsProps {
  readonly onBack: () => void;
  readonly onGoLinkedIn: () => void;
  readonly onGoHh: () => void;
}

function ConnectedPlatformsGroup({
  onGoLinkedIn,
  onGoHh,
}: Pick<MobileConnectionsProps, 'onGoLinkedIn' | 'onGoHh'>) {
  return (
    <div className="career-account-mobile-group">
      <button type="button" className="career-account-mobile-row" onClick={onGoLinkedIn}>
        <div className="career-account-row-content">
          <span className="career-account-row-label">LinkedIn</span>
          <span className="career-account-row-desc">
            вход сохранён до 10.10 · 9 из 9 мест
          </span>
        </div>
        <div className="career-account-row-right">
          <span className="career-account-tag is-ok">Подключено</span>
          <CaretRight size={18} aria-hidden="true" />
        </div>
      </button>
      <button type="button" className="career-account-mobile-row" onClick={onGoHh}>
        <div className="career-account-row-content">
          <span className="career-account-row-label">hh.ru</span>
          <span className="career-account-row-desc">8 из 9 мест работы</span>
        </div>
        <div className="career-account-row-right">
          <span className="career-account-tag is-warn">Частично</span>
          <CaretRight size={18} aria-hidden="true" />
        </div>
      </button>
      <div className="career-account-mobile-row">
        <div className="career-account-row-content">
          <span className="career-account-row-label">Другие площадки</span>
          <span className="career-account-row-desc">открываются при подключении</span>
        </div>
        <span className="career-account-tag is-dim">Не подключено</span>
      </div>
    </div>
  );
}

function ChannelsGroup() {
  return (
    <div className="career-account-mobile-group">
      <div className="career-account-mobile-row">
        <div className="career-account-row-content">
          <span className="career-account-row-label">Почта</span>
          <span className="career-account-row-desc">для ответов работодателей</span>
        </div>
        <span className="career-account-tag is-dim">Не подключено</span>
      </div>
      <div className="career-account-mobile-row">
        <div className="career-account-row-content">
          <span className="career-account-row-label">Календарь</span>
          <span className="career-account-row-desc">для интервью</span>
        </div>
        <span className="career-account-tag is-dim">Не подключено</span>
      </div>
      <div className="career-account-mobile-row">
        <div className="career-account-row-content">
          <span className="career-account-row-label">Telegram</span>
          <span className="career-account-row-desc">бот @openqareer_bot</span>
        </div>
        <span className="career-account-tag is-dim">Не подключено</span>
      </div>
    </div>
  );
}

export function MobileAccountConnections({
  onBack,
  onGoLinkedIn,
  onGoHh,
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
      <ConnectedPlatformsGroup onGoLinkedIn={onGoLinkedIn} onGoHh={onGoHh} />
      <ChannelsGroup />
    </div>
  );
}

export function MobileAccountLinkedIn({
  onBack,
  onDisconnect,
}: {
  readonly onBack: () => void;
  readonly onDisconnect: () => void;
}) {
  return (
    <div className="career-account-mobile-view" data-mv="li">
      <div className="career-account-mobile-header">
        <button
          type="button"
          className="career-account-mobile-back-btn"
          onClick={onBack}
          aria-label="Назад"
        >
          <CaretLeft size={20} aria-hidden="true" />
        </button>
        <h2 className="career-account-title">LinkedIn</h2>
      </div>
      <p className="career-account-lead">
        Импортировано 9 из 9 мест работы. Контактов 412.
      </p>
      <div className="career-account-mobile-group">
        <label htmlFor="li-contacts-chk" className="career-account-mobile-row">
          <span className="career-account-row-label">Использовать контакты для маршрутов</span>
          <input id="li-contacts-chk" type="checkbox" defaultChecked />
        </label>
        <label htmlFor="li-posts-chk" className="career-account-mobile-row">
          <span className="career-account-row-label">Готовить черновики постов</span>
          <input id="li-posts-chk" type="checkbox" defaultChecked />
        </label>
      </div>
      <button
        type="button"
        className="career-account-mobile-danger-btn"
        onClick={onDisconnect}
      >
        <X size={18} aria-hidden="true" />
        Отключить LinkedIn
      </button>
    </div>
  );
}

export function MobileAccountHh({
  onBack,
  onDisconnect,
}: {
  readonly onBack: () => void;
  readonly onDisconnect: () => void;
}) {
  return (
    <div className="career-account-mobile-view" data-mv="hh">
      <div className="career-account-mobile-header">
        <button
          type="button"
          className="career-account-mobile-back-btn"
          onClick={onBack}
          aria-label="Назад"
        >
          <CaretLeft size={20} aria-hidden="true" />
        </button>
        <h2 className="career-account-title">hh.ru</h2>
      </div>
      <div className="career-account-row">
        <span className="career-account-row-desc">
          Импортировано 8 из 9 мест работы.
        </span>
      </div>
      <div className="career-account-mobile-group">
        <label htmlFor="hh-apply-chk" className="career-account-mobile-row">
          <span className="career-account-row-label">Отправлять отклики через этот аккаунт</span>
          <input id="hh-apply-chk" type="checkbox" defaultChecked />
        </label>
      </div>
      <button
        type="button"
        className="career-account-mobile-danger-btn"
        onClick={onDisconnect}
      >
        <X size={18} aria-hidden="true" />
        Отключить hh.ru
      </button>
    </div>
  );
}

interface MobileNotificationsProps {
  readonly events: readonly AccountNotificationEvent[];
  readonly onBack: () => void;
  readonly onSelectEvent: (index: number) => void;
}

function MandatoryNotifGroup() {
  return (
    <div className="career-account-mobile-group">
      <div className="career-account-mobile-row">
        <div className="career-account-row-content">
          <span className="career-account-row-label">Платежи</span>
          <span className="career-account-row-desc">
            Приложение, Почта · письмо до списания, чек
          </span>
        </div>
      </div>
      <div className="career-account-mobile-row">
        <div className="career-account-row-content">
          <span className="career-account-row-label">Безопасность</span>
          <span className="career-account-row-desc">
            Приложение, Почта · новый вход, смена пароля
          </span>
        </div>
      </div>
    </div>
  );
}

export function MobileAccountNotifications({
  events,
  onBack,
  onSelectEvent,
}: MobileNotificationsProps) {
  return (
    <div className="career-account-mobile-view" data-mv="notif">
      <div className="career-account-mobile-header">
        <button
          type="button"
          className="career-account-mobile-back-btn"
          onClick={onBack}
          aria-label="Назад"
        >
          <CaretLeft size={20} aria-hidden="true" />
        </button>
        <h2 className="career-account-title">Уведомления</h2>
      </div>
      <p className="career-account-lead">
        Откройте событие, чтобы выбрать каналы. Важное включено сразу.
      </p>
      <div className="career-account-mobile-group">
        {events.map((e) => (
          <button
            key={e.id}
            type="button"
            className="career-account-mobile-row"
            onClick={() => onSelectEvent(e.index)}
          >
            <div className="career-account-row-content">
              <span className="career-account-row-label">{e.title}</span>
              <span className="career-account-row-desc">Приложение, Почта</span>
            </div>
            <CaretRight size={18} aria-hidden="true" />
          </button>
        ))}
      </div>
      <MandatoryNotifGroup />
      <div className="career-account-row">
        <span className="career-account-row-desc">
          Telegram не подключён. Бот подключается на вкладке «Подключения».
        </span>
      </div>
    </div>
  );
}

export function MobileAccountEventDetail({
  event,
  onBack,
}: {
  readonly event: AccountNotificationEvent;
  readonly onBack: () => void;
}) {
  return (
    <div className="career-account-mobile-view" data-mv={`ev${event.index}`}>
      <div className="career-account-mobile-header">
        <button
          type="button"
          className="career-account-mobile-back-btn"
          onClick={onBack}
          aria-label="Назад"
        >
          <CaretLeft size={20} aria-hidden="true" />
        </button>
        <h2 className="career-account-title">{event.title}</h2>
      </div>
      <p className="career-account-lead">{event.timing}</p>
      <div className="career-account-mobile-group">
        <label htmlFor={`ev-${event.index}-app`} className="career-account-mobile-row">
          <span className="career-account-row-label">Приложение</span>
          <input id={`ev-${event.index}-app`} type="checkbox" defaultChecked={event.app} />
        </label>
        <div className="career-account-mobile-row">
          <div className="career-account-row-content">
            <span className="career-account-row-label">Telegram</span>
            <span className="career-account-row-desc">Недоступно без бота</span>
          </div>
          <input type="checkbox" disabled aria-label="Telegram" />
        </div>
        <label htmlFor={`ev-${event.index}-mail`} className="career-account-mobile-row">
          <span className="career-account-row-label">Почта</span>
          <input id={`ev-${event.index}-mail`} type="checkbox" defaultChecked={event.email} />
        </label>
      </div>
      <p className="career-account-row-desc">{event.reason}</p>
    </div>
  );
}

interface MobileConsentsProps {
  readonly consents: readonly AccountConsent[];
  readonly onBack: () => void;
  readonly onToggleConsent: (c: AccountConsent) => void;
  readonly onDeleteAccount: () => void;
}

export function MobileAccountConsents({
  consents,
  onBack,
  onToggleConsent,
  onDeleteAccount,
}: MobileConsentsProps) {
  return (
    <div className="career-account-mobile-view" data-mv="cons">
      <div className="career-account-mobile-header">
        <button
          type="button"
          className="career-account-mobile-back-btn"
          onClick={onBack}
          aria-label="Назад"
        >
          <CaretLeft size={20} aria-hidden="true" />
        </button>
        <h2 className="career-account-title">Согласия и данные</h2>
      </div>
      <p className="career-account-lead">Согласия сохраняются с датой.</p>
      <div className="career-account-mobile-group">
        {consents.map((item) => (
          <button
            key={item.id}
            type="button"
            className="career-account-mobile-row"
            onClick={() => onToggleConsent(item)}
          >
            <div className="career-account-row-content">
              <span className="career-account-row-label">{item.title}</span>
              <span className="career-account-row-desc">
                {item.date ? `дано ${item.date}` : 'не дано'}
              </span>
            </div>
            <input type="checkbox" checked={Boolean(item.date)} readOnly tabIndex={-1} />
          </button>
        ))}
      </div>
      <button
        type="button"
        className="career-account-mobile-danger-btn"
        onClick={onDeleteAccount}
      >
        <Trash size={18} aria-hidden="true" />
        Удалить аккаунт
      </button>
    </div>
  );
}

interface MobileSubscriptionProps {
  readonly isPro: boolean;
  readonly payments: readonly AccountPaymentItem[];
  readonly onBack: () => void;
  readonly onOpenTariffs?: () => void;
}

function MobilePaymentsList({ payments }: { readonly payments: readonly AccountPaymentItem[] }) {
  return (
    <div className="career-account-mobile-group">
      <div className="career-account-mobile-row">
        <span className="career-account-row-label">История платежей</span>
        <span className="career-account-row-desc">{payments.length}</span>
      </div>
      {payments.map((p) => (
        <div key={p.date + p.title} className="career-account-mobile-row">
          <div className="career-account-row-content">
            <span className="career-account-row-label">{p.title}</span>
            <span className="career-account-row-desc">{p.date} · {p.method}</span>
          </div>
          <span className="career-account-num">{p.amount}</span>
        </div>
      ))}
    </div>
  );
}

export function MobileAccountSubscription({
  isPro,
  payments,
  onBack,
  onOpenTariffs,
}: MobileSubscriptionProps) {
  return (
    <div className="career-account-mobile-view" data-mv="pay">
      <div className="career-account-mobile-header">
        <button
          type="button"
          className="career-account-mobile-back-btn"
          onClick={onBack}
          aria-label="Назад"
        >
          <CaretLeft size={20} aria-hidden="true" />
        </button>
        <h2 className="career-account-title">Подписка и платежи</h2>
      </div>
      <div className="career-account-mobile-group">
        <div className="career-account-mobile-row">
          <span className="career-account-row-label">Тариф</span>
          <span className="career-account-tag is-ok">{isPro ? 'Pro' : 'Free'}</span>
        </div>
      </div>
      {isPro ? (
        <MobilePaymentsList payments={payments} />
      ) : (
        <div>
          <button type="button" className="career-btn is-primary" onClick={onOpenTariffs}>
            <TrendUp size={16} aria-hidden="true" />
            Выбрать тариф
          </button>
        </div>
      )}
    </div>
  );
}
