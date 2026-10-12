import { useState } from 'react';
import { CaretLeft, CaretRight } from '@phosphor-icons/react';
import './account.css';
import type { AccountNotificationEvent } from './accountTypes';

interface NotificationsSectionProps {
  readonly events: readonly AccountNotificationEvent[];
  readonly mandatoryEvents: readonly AccountNotificationEvent[];
  readonly telegramAvailable?: boolean;
  readonly telegramConnected?: boolean;
  readonly emailAvailable?: boolean;
  readonly securitySourceAvailable?: boolean;
  readonly billingSourceAvailable?: boolean;
  readonly settingsReady?: boolean;
  readonly savingKey?: string | null;
  readonly startUrl?: string | null;
  readonly statusMessage?: string | null;
  readonly onPreferenceChange?: (
    key: AccountNotificationEvent['id'],
    channel: 'app' | 'email' | 'telegram',
    enabled: boolean,
  ) => void;
  readonly onStartTelegramLink?: () => void;
  readonly onDisconnectTelegram?: () => void;
  readonly onRefreshChannels?: () => void;
  readonly onReload?: () => void;
}

export function AccountNotificationsSection(props: NotificationsSectionProps) {
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const selectedEvent =
    props.events.find((event) => event.id === selectedEventId) ??
    props.mandatoryEvents.find((event) => event.id === selectedEventId) ??
    null;
  return (
    <section className="career-account-card" aria-labelledby="notif-title">
      <NotificationHeading />
      <DesktopNotificationTable props={props} />
      <MobileNotificationSurface
        props={props}
        selectedEvent={selectedEvent}
        onSelect={(id) => setSelectedEventId(id)}
        onBack={() => setSelectedEventId(null)}
      />
      <NotificationStatus props={props} />
      <div className="career-account-notifications-desktop">
        <NotificationTelegramConnection props={props} />
      </div>
      <DoNotDisturbSummary />
    </section>
  );
}

function NotificationHeading() {
  return (
    <div className="career-account-card-header">
      <h3 id="notif-title" className="career-account-card-title">
        Уведомления
      </h3>
    </div>
  );
}

function DesktopNotificationTable({ props }: { readonly props: NotificationsSectionProps }) {
  return (
    <div className="career-account-table-wrap career-account-notifications-desktop">
      <table className="career-account-table">
        <thead>
          <tr>
            <th>Событие</th>
            <th className="career-account-table-tc">Приложение</th>
            <th className="career-account-table-tc">Telegram</th>
            <th className="career-account-table-tc">Почта</th>
          </tr>
        </thead>
        <tbody>
          {props.events.map((event) => (
            <DesktopOptionalRow key={event.id} event={event} props={props} />
          ))}
          {props.mandatoryEvents.map((event) => (
            <DesktopMandatoryRow key={event.id} event={event} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DesktopOptionalRow({
  event,
  props,
}: {
  readonly event: AccountNotificationEvent;
  readonly props: NotificationsSectionProps;
}) {
  const disabled = !props.settingsReady || Boolean(props.savingKey) || !props.onPreferenceChange;
  return (
    <tr>
      <td>
        <strong>{event.title}</strong>
      </td>
      <td className="career-account-table-tc">
        <NotificationInput
          event={event}
          channel="app"
          checked={event.app}
          disabled={disabled}
          onChange={props.onPreferenceChange}
        />
      </td>
      <td className="career-account-table-tc">
        <NotificationInput
          event={event}
          channel="telegram"
          checked={event.telegram}
          disabled={disabled || !props.telegramAvailable || !props.telegramConnected}
          onChange={props.onPreferenceChange}
        />
      </td>
      <td className="career-account-table-tc">
        <NotificationInput
          event={event}
          channel="email"
          checked={event.email}
          disabled={disabled || !props.emailAvailable}
          onChange={props.onPreferenceChange}
        />
      </td>
    </tr>
  );
}

function DesktopMandatoryRow({ event }: { readonly event: AccountNotificationEvent }) {
  return (
    <tr>
      <td>
        <strong>{event.title}</strong>
        <br />
        <span className="career-account-row-desc">{event.mandatoryNote}</span>
      </td>
      <td className="career-account-table-tc">
        <input type="checkbox" checked disabled aria-label={`${event.title}, приложение`} />
      </td>
      <td className="career-account-table-tc">
        <input type="checkbox" disabled aria-label={`${event.title}, Telegram`} />
      </td>
      <td className="career-account-table-tc">
        <input type="checkbox" checked disabled aria-label={`${event.title}, почта`} />
      </td>
    </tr>
  );
}

function NotificationInput({
  event,
  channel,
  checked,
  disabled,
  onChange,
}: {
  readonly event: AccountNotificationEvent;
  readonly channel: 'app' | 'email' | 'telegram';
  readonly checked: boolean;
  readonly disabled: boolean;
  readonly onChange?: NotificationsSectionProps['onPreferenceChange'];
}) {
  const label = channel === 'app' ? 'приложение' : channel === 'email' ? 'почта' : 'Telegram';
  return (
    <input
      type="checkbox"
      checked={checked}
      disabled={disabled}
      aria-label={`${event.title}, ${label}`}
      data-notification-key={event.id}
      data-channel={channel}
      onChange={(inputEvent) => onChange?.(event.id, channel, inputEvent.currentTarget.checked)}
    />
  );
}

function MobileNotificationSurface({
  props,
  selectedEvent,
  onSelect,
  onBack,
}: {
  readonly props: NotificationsSectionProps;
  readonly selectedEvent: AccountNotificationEvent | null;
  readonly onSelect: (id: string) => void;
  readonly onBack: () => void;
}) {
  return (
    <div className="career-account-notifications-mobile" aria-live="polite">
      {selectedEvent ? (
        <MobileNotificationDetail event={selectedEvent} props={props} onBack={onBack} />
      ) : (
        <MobileNotificationList props={props} onSelect={onSelect} />
      )}
    </div>
  );
}

function MobileNotificationList({
  props,
  onSelect,
}: {
  readonly props: NotificationsSectionProps;
  readonly onSelect: (id: string) => void;
}) {
  const events = [...props.events, ...props.mandatoryEvents];
  return (
    <div className="career-account-mobile-view" data-mv="notifications">
      <p className="career-account-lead">
        Откройте событие, чтобы выбрать каналы. Важные уведомления включены.
      </p>
      <div className="career-account-mobile-group">
        {events.map((event) => (
          <button
            key={event.id}
            type="button"
            className="career-account-mobile-row"
            onClick={() => onSelect(event.id)}
          >
            <span className="career-account-row-content">
              <span className="career-account-row-label">{event.title}</span>
              <span className="career-account-row-desc">
                {event.mandatory ? 'Обязательное' : event.timing}
              </span>
            </span>
            <CaretRight size={18} aria-hidden="true" />
          </button>
        ))}
      </div>
      <NotificationTelegramConnection props={props} />
      {!props.emailAvailable ? <EmailChannelNote /> : null}
      {!props.securitySourceAvailable ? <SecuritySourceNote /> : null}
      {!props.billingSourceAvailable ? <BillingSourceNote /> : null}
    </div>
  );
}

function MobileNotificationDetail({
  event,
  props,
  onBack,
}: {
  readonly event: AccountNotificationEvent;
  readonly props: NotificationsSectionProps;
  readonly onBack: () => void;
}) {
  return (
    <div className="career-account-mobile-view" data-mv={`notification-${event.id}`}>
      <div className="career-account-mobile-header">
        <button
          type="button"
          className="career-account-mobile-back-btn"
          aria-label="Назад"
          onClick={onBack}
        >
          <CaretLeft size={20} aria-hidden="true" />
        </button>
        <h3 className="career-account-title">{event.title}</h3>
      </div>
      <p className="career-account-lead">{event.timing}</p>
      <MobileChannelControls event={event} props={props} />
      <p className="career-account-row-desc">{event.reason}</p>
      {!props.emailAvailable ? <EmailChannelNote /> : null}
      {event.id === 'mand-security' && !props.securitySourceAvailable ? (
        <SecuritySourceNote />
      ) : null}
      {event.id === 'mand-payments' && !props.billingSourceAvailable ? <BillingSourceNote /> : null}
    </div>
  );
}

function MobileChannelControls({
  event,
  props,
}: {
  readonly event: AccountNotificationEvent;
  readonly props: NotificationsSectionProps;
}) {
  const channels = ['app', 'telegram', 'email'] as const;
  if (event.mandatory)
    return (
      <div className="career-account-mobile-group">
        {channels.map((channel) => (
          <MandatoryMobileChannel key={channel} event={event} channel={channel} />
        ))}
        <span className="career-account-row-desc career-account-mobile-row">
          Обязательное, отключить нельзя
        </span>
      </div>
    );
  const disabled = !props.settingsReady || Boolean(props.savingKey) || !props.onPreferenceChange;
  return (
    <div className="career-account-mobile-group">
      {channels.map((channel) => (
        <OptionalMobileChannel
          key={channel}
          event={event}
          props={props}
          channel={channel}
          disabled={disabled}
        />
      ))}
    </div>
  );
}

function MandatoryMobileChannel({
  event,
  channel,
}: {
  readonly event: AccountNotificationEvent;
  readonly channel: 'app' | 'telegram' | 'email';
}) {
  const label = channel === 'app' ? 'Приложение' : channel === 'email' ? 'Почта' : 'Telegram';
  return (
    <label className="career-account-mobile-row">
      <span className="career-account-row-label">{label}</span>
      <input
        type="checkbox"
        checked={channel !== 'telegram'}
        disabled
        aria-label={`${event.title}, ${label}`}
      />
    </label>
  );
}

function OptionalMobileChannel({
  event,
  props,
  channel,
  disabled,
}: {
  readonly event: AccountNotificationEvent;
  readonly props: NotificationsSectionProps;
  readonly channel: 'app' | 'telegram' | 'email';
  readonly disabled: boolean;
}) {
  const checked =
    channel === 'app' ? event.app : channel === 'email' ? event.email : event.telegram;
  const unavailable =
    channel === 'telegram'
      ? !props.telegramAvailable || !props.telegramConnected
      : channel === 'email' && !props.emailAvailable;
  const label = channel === 'app' ? 'Приложение' : channel === 'email' ? 'Почта' : 'Telegram';
  return (
    <label className="career-account-mobile-row">
      <span className="career-account-row-label">{label}</span>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled || unavailable}
        data-notification-key={event.id}
        data-channel={channel}
        aria-label={`${event.title}, ${label}`}
        onChange={(inputEvent) =>
          props.onPreferenceChange?.(event.id, channel, inputEvent.currentTarget.checked)
        }
      />
    </label>
  );
}

function NotificationTelegramConnection({ props }: { readonly props: NotificationsSectionProps }) {
  const connected = props.telegramConnected ?? false;
  const available = props.telegramAvailable ?? false;
  return (
    <div className="career-account-row career-account-notification-telegram">
      <div className="career-account-row-content">
        <span className="career-account-row-label">
          {connected ? 'Telegram подключён' : 'Telegram не подключён'}
        </span>
        <span className="career-account-row-desc">
          {available
            ? 'Бот @openqareer_bot отправляет выбранные уведомления.'
            : 'Столбец Telegram недоступен, пока бот не подключён.'}
        </span>
        {props.startUrl ? (
          <a href={props.startUrl} target="_blank" rel="noreferrer">
            Открыть @openqareer_bot
          </a>
        ) : null}
      </div>
      <NotificationTelegramActions props={props} connected={connected} available={available} />
      {props.statusMessage ? (
        <span className="career-account-row-desc">{props.statusMessage}</span>
      ) : null}
    </div>
  );
}

function NotificationTelegramActions({
  props,
  connected,
  available,
}: {
  readonly props: NotificationsSectionProps;
  readonly connected: boolean;
  readonly available: boolean;
}) {
  return (
    <div className="career-account-notification-actions">
      {connected && props.onDisconnectTelegram ? (
        <button
          type="button"
          className="career-btn is-ghost is-sm"
          onClick={props.onDisconnectTelegram}
        >
          Отключить
        </button>
      ) : null}
      {!connected && available && props.onStartTelegramLink ? (
        <button
          type="button"
          className="career-btn is-ghost is-sm"
          onClick={props.onStartTelegramLink}
        >
          Подключить Telegram
        </button>
      ) : null}
      {!connected && props.onRefreshChannels ? (
        <button
          type="button"
          className="career-btn is-ghost is-sm"
          onClick={props.onRefreshChannels}
        >
          Проверить подключение
        </button>
      ) : null}
    </div>
  );
}

function NotificationStatus({ props }: { readonly props: NotificationsSectionProps }) {
  return (
    <div className="career-account-notifications-status" aria-live="polite">
      {!props.settingsReady ? (
        <p className="career-account-row-desc">
          {props.statusMessage ?? 'Загружаем настройки уведомлений…'}
        </p>
      ) : null}
      {!props.emailAvailable ? <EmailChannelNote /> : null}
      {!props.securitySourceAvailable ? <SecuritySourceNote /> : null}
      {!props.billingSourceAvailable ? <BillingSourceNote /> : null}
      {!props.settingsReady && props.onReload ? (
        <button type="button" className="career-btn is-ghost is-sm" onClick={props.onReload}>
          Повторить загрузку
        </button>
      ) : null}
    </div>
  );
}

function EmailChannelNote() {
  return (
    <p className="career-account-row-desc">
      Почтовая доставка недоступна: отправка писем не настроена.
    </p>
  );
}

function BillingSourceNote() {
  return (
    <p className="career-account-row-desc">
      Письма о списании и чеки пока не формируются: источник платежей не подключён.
    </p>
  );
}

function SecuritySourceNote() {
  return (
    <p className="career-account-row-desc">
      Уведомления о новых входах пока не формируются: источник событий безопасности не подключён.
    </p>
  );
}

function DoNotDisturbSummary() {
  return (
    <div className="career-account-row">
      <div className="career-account-row-content">
        <span className="career-account-row-label">Не беспокоить</span>
        <span className="career-account-row-desc">
          Ночной режим пока не настроен; письма отправляются по выбранным каналам.
        </span>
      </div>
      <span className="career-account-tag is-dim">Подготовлено</span>
    </div>
  );
}
