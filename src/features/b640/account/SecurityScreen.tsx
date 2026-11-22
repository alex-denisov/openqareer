import { useId, useState } from 'react';
import {
  getPendingAccountEmailChange,
  type PendingAccountEmailChange,
} from '../../account/accountEmailChangeApi';
import type { AccountSnapshot } from '../../coach/cabinetTypes';
import { getAccount, revokeAccountSession, revokeOtherSessions } from '../../coach/coachApi';
import { ResultLine } from '../kit/ResultLine';
import type { B640Node } from '../routes';
import { useShell } from '../shell/ShellContext';
import { deviceLine, deviceName, devicesTitle, type AccountSession } from './model';
import { ErrorLine, SettingsPage, useLoad, type Load } from './parts';
import { EmailCodeForm, EmailForm, NameForm, PasswordForm } from './securityForms';
import { PasskeyForm, PasskeyRow, usePasskeys, type PasskeyState } from './PasskeySection';
import { getTwoFactorStatus } from './twoFactorApi';
import { TwoFactorPanel, TwoFactorRow, type TwoFactorState, type TwoFactorView } from './TwoFactorSection';

interface Security {
  readonly account: AccountSnapshot;
  /** Новая почта ждёт кода из письма. */
  readonly pendingEmail: PendingAccountEmailChange | null;
}

async function loadSecurity(): Promise<Security> {
  const [account, pendingEmail] = await Promise.all([
    getAccount(),
    getPendingAccountEmailChange().catch(() => null),
  ]);
  return { account, pendingEmail };
}

type Editing = 'email' | 'name' | 'password' | null;

interface RowProps {
  readonly title: string;
  readonly value?: string | null;
  readonly action?: string;
  readonly onAction?: () => void;
}

function Row({ title, value, action, onAction }: RowProps) {
  return (
    <li className="set-row">
      <div className="set-l">
        <span className="set-t">{title}</span>
        {value ? <span className="set-v">{value}</span> : null}
      </div>
      {action ? (
        <div className="set-r">
          <button className="btn is-sm" type="button" onClick={onAction}>
            {action}
          </button>
        </div>
      ) : null}
    </li>
  );
}

function Group({ title, children }: { readonly title: string; readonly children: React.ReactNode }) {
  const id = useId();
  return (
    <section className="set-group" aria-labelledby={id}>
      <h3 className="set-h" id={id}>
        {title}
      </h3>
      <ul className="set-list">{children}</ul>
    </section>
  );
}

interface SectionProps {
  readonly data: Security;
  readonly load: Load<Security>;
}

function emailLine(email: string | null, verified: boolean, pending: PendingAccountEmailChange | null) {
  if (pending) return `${email ?? ''} · ждёт кода: ${pending.email}`.replace(/^ · /u, '');
  return [email, verified ? 'подтверждена' : 'не подтверждена'].filter(Boolean).join(' · ');
}

/** «Почта и имя»: правка на месте строки. */
function Identity({ data, load }: SectionProps) {
  const { session } = useShell();
  const { account, pendingEmail } = data;
  const [editing, setEditing] = useState<Editing>(pendingEmail ? 'email' : null);
  const [saved, setSaved] = useState<string | null>(null);
  const done = (text: string) => {
    setEditing(null);
    setSaved(text);
    load.retry();
  };
  const close = () => setEditing(null);
  return (
    <Group title="Почта и имя">
      <Row
        title="Почта для входа"
        value={emailLine(account.email, session.emailVerified === true, pendingEmail)}
        action={editing === 'email' ? undefined : 'Изменить'}
        onAction={() => setEditing('email')}
      />
      {editing === 'email' && !pendingEmail ? (
        <EmailForm onCancel={close} onDone={({ pending }) => (pending ? load.retry() : done('Почта изменена'))} />
      ) : null}
      {editing === 'email' && pendingEmail ? (
        <EmailCodeForm email={pendingEmail.email} onCancel={close} onDone={() => done('Почта изменена')} />
      ) : null}
      <Row
        title="Имя"
        value={account.displayName}
        action={editing === 'name' ? undefined : 'Изменить'}
        onAction={() => setEditing('name')}
      />
      {editing === 'name' ? (
        <NameForm
          name={account.displayName ?? ''}
          onCancel={close}
          onDone={(next) => {
            load.replace({ ...data, account: next });
            setEditing(null);
            setSaved('Имя сохранено');
          }}
        />
      ) : null}
      {saved ? (
        <li className="set-foot">
          <ResultLine text={saved} />
        </li>
      ) : null}
    </Group>
  );
}

/** «Вход»: смена пароля на месте (макет N4b) и строка двухфакторной защиты (B401). */
interface SignInProps {
  readonly onChanged: () => void;
  readonly twoFactor: TwoFactorState;
  readonly passkeys: PasskeyState;
  /** Название этого устройства из списка сеансов: по нему видно, есть ли здесь ключ. */
  readonly deviceLabel: string | null;
}

function SignIn({ onChanged, twoFactor, passkeys, deviceLabel }: SignInProps) {
  const needsCode = twoFactor.load.state === 'ready' && twoFactor.load.data.enabled;
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  return (
    <Group title={open ? 'Сменить пароль' : 'Вход'}>
      {open ? (
        <PasswordForm
          needsCode={needsCode}
          onCancel={() => setOpen(false)}
          onDone={() => {
            setOpen(false);
            setSaved(true);
            // Смена пароля завершает остальные сеансы: список устройств перечитывается.
            onChanged();
          }}
        />
      ) : (
        <>
          <Row title="Пароль" action="Сменить пароль" onAction={() => setOpen(true)} />
          <TwoFactorRow state={twoFactor} />
          <PasskeyRow state={passkeys} currentLabel={deviceLabel} />
          <PasskeyForm state={passkeys} needsCode={needsCode} />
        </>
      )}
      {saved && !open ? (
        <li className="set-foot">
          <ResultLine text="Пароль изменён" />
        </li>
      ) : null}
    </Group>
  );
}

/** Завершение сеансов: одного устройства и всех остальных. */
function useRevoke(load: Load<Security>) {
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  async function run(id: string, action: () => Promise<unknown>) {
    setBusy(id);
    setFailed(false);
    try {
      await action();
      load.retry();
    } catch {
      setFailed(true);
    } finally {
      setBusy(null);
    }
  }
  return {
    busy,
    failed,
    revoke: (session: AccountSession) => void run(session.id, () => revokeAccountSession(session.id)),
    revokeOthers: () => void run('others', revokeOtherSessions),
  };
}

function Devices({ data, load }: SectionProps) {
  const { sessions } = data.account;
  const { busy, failed, revoke, revokeOthers } = useRevoke(load);
  const others = sessions.filter((session) => !session.current);
  return (
    <Group title={devicesTitle(sessions.length)}>
      {sessions.map((session) => (
        <li className="set-row" key={session.id}>
          <div className="set-l">
            <span className="set-t">{deviceName(session)}</span>
            <span className="set-v">{deviceLine(session)}</span>
          </div>
          {session.current ? null : (
            <div className="set-r">
              <button
                className="btn is-sm"
                type="button"
                aria-label={`Завершить сеанс: ${deviceName(session).toLowerCase()}, ${deviceLine(session)}`}
                disabled={busy !== null}
                onClick={() => revoke(session)}
              >
                Завершить
              </button>
            </div>
          )}
        </li>
      ))}
      {failed ? (
        <li className="set-foot">
          <ErrorLine text="Сеанс не завершился" />
        </li>
      ) : null}
      {others.length > 0 ? (
        <li className="set-foot">
          <button className="btn is-sm" type="button" disabled={busy !== null} onClick={revokeOthers}>
            Выйти на других устройствах
          </button>
        </li>
      ) : null}
    </Group>
  );
}

function SignOut() {
  const { signOut } = useShell();
  const [failed, setFailed] = useState(false);
  return (
    <section className="set-group" aria-label="Выход">
      <ul className="set-list">
        <li className="set-row">
          <button className="set-rowbtn" type="button" onClick={() => void signOut().catch(() => setFailed(true))}>
            Выйти из аккаунта
          </button>
        </li>
        {failed ? (
          <li className="set-foot">
            <ErrorLine text="Выйти не получилось" />
          </li>
        ) : null}
      </ul>
    </section>
  );
}

/** n04 «Вход и безопасность»: почта, имя, пароль, двухфакторная защита, устройства, выход. */
function useTwoFactor(): TwoFactorState {
  const load = useLoad(getTwoFactorStatus);
  const [view, setView] = useState<TwoFactorView>({ kind: 'idle' });
  return { load, view, setView };
}

export function SecurityScreen({ node }: { readonly node: B640Node }) {
  const load = useLoad(loadSecurity);
  const twoFactor = useTwoFactor();
  const passkeys = usePasskeys();
  return (
    <SettingsPage node={node} heading="Вход и безопасность" busy={load.state === 'loading'}>
      {load.state === 'error' ? <ErrorLine text="Раздел не загрузился" onRetry={load.retry} /> : null}
      {load.state === 'ready' ? (
        <>
          <Identity data={load.data} load={load} />
          <SignIn
            onChanged={load.retry}
            twoFactor={twoFactor}
            passkeys={passkeys}
            deviceLabel={load.data.account.sessions.find((session) => session.current)?.deviceLabel ?? null}
          />
          <TwoFactorPanel state={twoFactor} />
          <Devices data={load.data} load={load} />
          <SignOut />
        </>
      ) : null}
    </SettingsPage>
  );
}
