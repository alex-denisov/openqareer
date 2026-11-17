import { useId, useState } from 'react';
import {
  getNotificationChannelStatus,
  getNotificationPreferences,
  updateNotificationPreference,
  type NotificationChannelPreference,
  type NotificationChannelStatus,
} from '../../account/notificationPreferencesApi';
import type { B640Node } from '../routes';
import { CHANNEL_LABEL, NOTIFICATION_ROWS, type NotificationChannel, type NotificationRow } from './model';
import { ErrorLine, SettingsPage, useLoad } from './parts';
import { useTelegramLink, type TelegramLink } from './useTelegramLink';

interface Settings {
  readonly events: readonly NotificationChannelPreference[];
  readonly channels: NotificationChannelStatus;
}

async function loadSettings(): Promise<Settings> {
  const [events, channels] = await Promise.all([
    getNotificationPreferences(),
    getNotificationChannelStatus(),
  ]);
  return { events, channels };
}

const OFF = { app: false, email: false, telegram: false };

interface CellProps {
  readonly row: NotificationRow;
  readonly channel: NotificationChannel;
  readonly checked: boolean;
  readonly disabled: boolean;
  readonly onChange: (checked: boolean) => void;
}

function SwitchCell({ row, channel, checked, disabled, onChange }: CellProps) {
  return (
    <span className="sw-cell">
      <input
        className="sw"
        type="checkbox"
        role="switch"
        aria-label={`${row.label}: ${CHANNEL_LABEL[channel]}`}
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
    </span>
  );
}

/**
 * Telegram ещё не подключён: переключатель ведёт к подключению (макет N2). Разметка макета —
 * ссылка с ролью переключателя; нажатие и пробел начинают привязку на месте.
 */
function TelegramGate({ row, link }: { readonly row: NotificationRow; readonly link: TelegramLink }) {
  const start = (event: { preventDefault: () => void }) => {
    event.preventDefault();
    if (!link.busy) link.start();
  };
  return (
    <a
      className="sw-gate"
      href="#telegram"
      role="switch"
      aria-checked="false"
      aria-label={`${row.label}: Telegram — подключить Telegram`}
      aria-busy={link.busy || undefined}
      onClick={start}
      onKeyDown={(event) => event.key === ' ' && start(event)}
    >
      <span className="sw" aria-hidden="true" />
    </a>
  );
}

/** Состояние привязки Telegram на месте таблицы: ждём (N2b), подключён (N2c), ссылка устарела (N2d). */
function TelegramLine({ link }: { readonly link: TelegramLink }) {
  const { state } = link;
  if (link.failed) return <ErrorLine text="Telegram не ответил" />;
  if (state.step === 'waiting') {
    return (
      <p className="set-res" role="status">
        <span>Ждём подтверждения в Telegram</span>
        <a className="btn is-sm" href={state.startUrl} target="_blank" rel="noopener noreferrer">
          Открыть бота
        </a>
      </p>
    );
  }
  if (state.step === 'expired') {
    return (
      <p className="set-res is-err" role="status">
        <span>Ссылка устарела</span>
        <button className="btn is-sm" type="button" disabled={link.busy} onClick={link.start}>
          Получить новую
        </button>
      </p>
    );
  }
  if (state.step !== 'connected') return null;
  return (
    <p className="set-res" role="status">
      <span>Telegram подключён</span>
      <button className="btn is-sm" type="button" disabled={link.busy} onClick={link.unlink}>
        Отвязать
      </button>
    </p>
  );
}

interface MatrixProps {
  readonly events: readonly NotificationChannelPreference[];
  readonly columns: readonly NotificationChannel[];
  readonly link: TelegramLink;
  readonly saving: ReadonlySet<string>;
  readonly onToggle: (row: NotificationRow, channel: NotificationChannel, checked: boolean) => void;
}

function Matrix({ events, columns, link, saving, onToggle }: MatrixProps) {
  const connected = link.state.step === 'connected';
  return (
    <ul className="set-list">
      <li className="set-row set-mx is-head">
        <span />
        {columns.map((channel) => (
          <span className="set-ch" key={channel}>
            {CHANNEL_LABEL[channel]}
          </span>
        ))}
      </li>
      {NOTIFICATION_ROWS.map((row) => {
        const value = events.find((item) => item.key === row.key) ?? { key: row.key, ...OFF };
        return (
          <li className="set-row set-mx" key={row.key}>
            <span className="set-t">{row.label}</span>
            {columns.map((channel) =>
              channel === 'telegram' && !connected ? (
                <TelegramGate key={channel} row={row} link={link} />
              ) : (
                <SwitchCell
                  key={channel}
                  row={row}
                  channel={channel}
                  checked={value[channel]}
                  disabled={saving.has(row.key)}
                  onChange={(checked) => onToggle(row, channel, checked)}
                />
              ),
            )}
          </li>
        );
      })}
    </ul>
  );
}

const withEvent = (value: NotificationChannelPreference) => (settings: Settings): Settings => ({
  ...settings,
  events: [...settings.events.filter((item) => item.key !== value.key), value],
});

/**
 * Переключение одного события: значение меняется сразу, при сбое возвращается и показывается
 * строка. Строки сохраняются независимо: правка одной не затирает другую.
 */
function useToggle(settings: Settings, update: (change: (data: Settings) => Settings) => void) {
  const [saving, setSaving] = useState<ReadonlySet<string>>(new Set());
  const [failed, setFailed] = useState(false);
  async function toggle(row: NotificationRow, channel: NotificationChannel, checked: boolean) {
    if (saving.has(row.key)) return;
    const current = settings.events.find((item) => item.key === row.key) ?? { key: row.key, ...OFF };
    const next = { ...current, [channel]: checked };
    setSaving((keys) => new Set(keys).add(row.key));
    setFailed(false);
    update(withEvent(next));
    try {
      const { key: _key, ...preference } = next;
      update(withEvent(await updateNotificationPreference(row.key, preference)));
    } catch {
      update(withEvent(current));
      setFailed(true);
    } finally {
      setSaving((keys) => new Set([...keys].filter((key) => key !== row.key)));
    }
  }
  return { saving, failed, toggle };
}

function SettingsTable({ settings, load }: { settings: Settings; load: ReturnType<typeof useLoad<Settings>> }) {
  const titleId = useId();
  const { channels } = settings;
  const link = useTelegramLink(channels.telegram.connected, load.retry);
  const { saving, failed, toggle } = useToggle(settings, load.update);
  const columns: NotificationChannel[] = [
    'app',
    ...(channels.emailAvailable ? (['email'] as const) : []),
    ...(channels.telegram.available ? (['telegram'] as const) : []),
  ];
  return (
    <section className="set-group" aria-labelledby={titleId}>
      <h3 className="set-h" id={titleId}>
        Что и куда присылать
      </h3>
      {failed ? <ErrorLine text="Настройка не сохранилась" /> : null}
      {channels.telegram.available ? <TelegramLine link={link} /> : null}
      <Matrix
        events={settings.events}
        columns={columns}
        link={link}
        saving={saving}
        onToggle={(row, channel, checked) => void toggle(row, channel, checked)}
      />
    </section>
  );
}

/** n02 «Уведомления»: что и куда присылать, привязка Telegram на месте. */
export function NotificationSettingsScreen({ node }: { readonly node: B640Node }) {
  const load = useLoad(loadSettings);
  return (
    <SettingsPage node={node} heading="Настройки уведомлений" busy={load.state === 'loading'}>
      {load.state === 'error' ? <ErrorLine text="Настройки не загрузились" onRetry={load.retry} /> : null}
      {load.state === 'ready' ? <SettingsTable settings={load.data} load={load} /> : null}
    </SettingsPage>
  );
}
