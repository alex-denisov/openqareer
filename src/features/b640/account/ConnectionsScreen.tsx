import { useEffect, useId, useRef, useState } from 'react';
import {
  getNotificationChannelStatus,
  type NotificationChannelStatus,
} from '../../account/notificationPreferencesApi';
import {
  disconnectConnection,
  getConnections,
  type CandidateConnection,
} from '../../coach/coachApi';
import { disconnectAndForgetSession } from '../../connections/connectionState';
import { resetConnectorSession } from '../../connections/connectorSession';
import { isTauriEnvironment } from '../../../services/desktop/desktopBridge';
import { Icon } from '../kit/Icon';
import { useToast } from '../kit/Toast';
import { buildNodePath, type B640Node } from '../routes';
import { Link } from '../shell/Link';
import { useShell } from '../shell/ShellContext';
import { getHhSessionState } from './hhSessionApi';
import { connectedCount, connectionLine, PLATFORM_NAME, updatedLine } from './model';
import { ErrorLine, SettingsPage, useLoad } from './parts';

interface Connections {
  readonly platforms: readonly CandidateConnection[];
  /** Канал Telegram; `null` — состояние не прочиталось или канала нет. */
  readonly telegram: NotificationChannelStatus['telegram'] | null;
  /** B690: вход в hh.ru истёк; признак не прочитался — считаем, что нет. */
  readonly hhExpired: boolean;
}

async function loadConnections(): Promise<Connections> {
  const [platforms, channels, hhSession] = await Promise.all([
    getConnections(),
    getNotificationChannelStatus().catch(() => null),
    getHhSessionState().catch(() => null),
  ]);
  return {
    platforms,
    telegram: channels?.telegram.available ? channels.telegram : null,
    hhExpired: hhSession?.expired === true,
  };
}

type Platform = CandidateConnection['platform'];
const ORDER: readonly Platform[] = ['hh', 'linkedin'];

/** Закрывает меню и подтверждение по нажатию вне строки и по Esc. */
function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return undefined;
    const onClick = (event: MouseEvent) => {
      const target = event.target as Node;
      // Кнопка, открывшая подтверждение, уже убрана из строки: её нажатие — не «мимо».
      if (target.isConnected && !ref.current?.contains(target)) close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      close();
    };
    document.addEventListener('click', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);
  return ref;
}

interface PlatformRowProps {
  readonly connection: CandidateConnection;
  readonly onDisconnected: () => void;
  readonly expired?: boolean;
}

interface ConfirmProps {
  readonly name: string;
  readonly busy: boolean;
  readonly failed: boolean;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

/** Подтверждение отключения на месте строки (макет N3f). */
function DisconnectConfirm({ name, busy, failed, onConfirm, onCancel }: ConfirmProps) {
  const titleId = useId();
  // Фокус переходит в подтверждение: кнопка, открывшая его, из строки убрана.
  const focus = (dialog: HTMLDivElement | null) => dialog?.focus();
  return (
    <div className="va-pop cn-pop" role="dialog" aria-labelledby={titleId} tabIndex={-1} ref={focus}>
      <h3 className="va-pop-t" id={titleId}>
        Отключить {name}?
      </h3>
      {failed ? <ErrorLine text="Не отключилось" /> : null}
      <div className="va-pop-foot">
        <button className="btn is-danger" type="button" disabled={busy} aria-busy={busy || undefined} onClick={onConfirm}>
          Отключить
        </button>
        <button className="row-act" type="button" onClick={onCancel}>
          Оставить
        </button>
      </div>
    </div>
  );
}

type Opened = 'menu' | 'confirm' | null;

/** Отключение площадки: запись на сервере и, в приложении, вход на этом устройстве. */
function useDisconnect(platform: Platform, onDone: () => void) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  async function disconnect() {
    setBusy(true);
    setFailed(false);
    try {
      const { result } = await disconnectAndForgetSession(platform, {
        disconnect: disconnectConnection,
        forgetDeviceSession: resetConnectorSession,
        isDesktop: isTauriEnvironment(),
      });
      if (result.connectionRemoved) onDone();
      else setFailed(true);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }
  return { busy, failed, disconnect };
}

interface MenuProps {
  readonly open: boolean;
  readonly updated: string | null;
  readonly onDisconnect: () => void;
}

function ActionsMenu({ open, updated, onDisconnect }: MenuProps) {
  return (
    <ul className="lk-menu-l" role="menu" hidden={!open}>
      {updated ? (
        <li role="none" className="cn-menu-t">
          {updated}
        </li>
      ) : null}
      <li role="none">
        <button role="menuitem" type="button" className="is-danger" onClick={onDisconnect}>
          Отключить
        </button>
      </li>
    </ul>
  );
}

/** Действия подключённой площадки: «Отключить», меню с временем обновления, подтверждение. */
function PlatformActions({ connection, onDisconnected }: PlatformRowProps) {
  const name = PLATFORM_NAME[connection.platform];
  const [opened, setOpened] = useState<Opened>(null);
  const { busy, failed, disconnect } = useDisconnect(connection.platform, onDisconnected);
  const ref = useDismiss(opened !== null, () => setOpened(null));
  const updated = connection.status === 'connected' ? updatedLine(connection.lastImportedAt) : null;

  return (
    <div className="set-r cn-end" ref={ref}>
      {opened === 'confirm' ? null : (
        <button
          className="btn is-sm cn-off"
          type="button"
          aria-label={`Отключить ${name}`}
          onClick={() => setOpened('confirm')}
        >
          Отключить
        </button>
      )}
      <div className="lk-menu cn-menu">
        <button
          className="icon-btn"
          type="button"
          aria-label={`Ещё действия: ${name}`}
          aria-haspopup="menu"
          aria-expanded={opened === 'menu'}
          onClick={() => setOpened(opened === 'menu' ? null : 'menu')}
        >
          <Icon name="more" />
        </button>
        <ActionsMenu open={opened === 'menu'} updated={updated} onDisconnect={() => setOpened('confirm')} />
        {opened === 'confirm' ? (
          <DisconnectConfirm
            name={name}
            busy={busy}
            failed={failed}
            onConfirm={() => void disconnect()}
            onCancel={() => setOpened(null)}
          />
        ) : null}
      </div>
    </div>
  );
}

function PlatformRow({ connection, onDisconnected, expired }: PlatformRowProps) {
  return (
    <li className="set-row cn-row">
      <div className="set-l">
        <span className="set-t">{PLATFORM_NAME[connection.platform]}</span>
        {expired ? (
          <span className="set-v is-warn">
            <Icon name="warn" />
            вход истёк
          </span>
        ) : (
          <span className="set-v">{connectionLine(connection)}</span>
        )}
      </div>
      {connection.status === 'connected' ? (
        <PlatformActions connection={connection} onDisconnected={onDisconnected} />
      ) : null}
    </li>
  );
}

function MailRow({ email, verified }: { readonly email: string | null; readonly verified: boolean }) {
  const state = verified ? 'подтверждена' : 'не подтверждена';
  return (
    <li className="set-row cn-row">
      <div className="set-l">
        <span className="set-t">Почта</span>
        <span className="set-v">{[email, state].filter(Boolean).join(' · ')}</span>
      </div>
    </li>
  );
}

function TelegramRow({ telegram }: { readonly telegram: NonNullable<Connections['telegram']> }) {
  return (
    <li className="set-row cn-row">
      <div className="set-l">
        <span className="set-t">Telegram</span>
        {telegram.connected ? <span className="set-v">подключён</span> : null}
      </div>
      {telegram.connected ? null : (
        <div className="set-r cn-end">
          <Link className="btn is-sm" to={buildNodePath('n02')} aria-label="Подключить Telegram">
            Подключить
          </Link>
        </div>
      )}
    </li>
  );
}

/** n03 «Подключения»: почта, площадки и Telegram; отключение — на месте строки (N3f). */
export function ConnectionsScreen({ node }: { readonly node: B640Node }) {
  const { session } = useShell();
  const toast = useToast();
  const load = useLoad(loadConnections);
  const titleId = useId();
  if (load.state !== 'ready') {
    return (
      <SettingsPage node={node} heading="Подключения" busy={load.state === 'loading'}>
        {load.state === 'error' ? <ErrorLine text="Подключения не загрузились" onRetry={load.retry} /> : null}
      </SettingsPage>
    );
  }
  const { platforms, telegram, hhExpired } = load.data;
  const count = connectedCount({
    emailVerified: session.emailVerified === true,
    connections: platforms,
    telegram: telegram ? telegram.connected : null,
  });
  const rows = ORDER.flatMap((platform) => platforms.filter((item) => item.platform === platform));
  const disconnected = (platform: Platform) => {
    toast.show({ text: `${PLATFORM_NAME[platform]}: отключено` });
    load.retry();
  };
  return (
    <SettingsPage node={node} heading="Подключения">
      <section className="set-group" aria-labelledby={titleId}>
        <h3 className="set-h" id={titleId}>
          Подключено {count.connected} из {count.total}
        </h3>
        <ul className="set-list">
          <MailRow email={session.email} verified={session.emailVerified === true} />
          {rows.map((connection) => (
            <PlatformRow
              key={connection.platform}
              connection={connection}
              expired={connection.platform === 'hh' && connection.status === 'connected' && hhExpired}
              onDisconnected={() => disconnected(connection.platform)}
            />
          ))}
          {telegram ? <TelegramRow telegram={telegram} /> : null}
        </ul>
      </section>
    </SettingsPage>
  );
}
