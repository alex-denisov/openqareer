import { useId, useState } from 'react';
import { Dialog } from '../kit/Dialog';
import { ErrorLine, type Load } from './parts';
import { BackupCodes, CodeField, SetupForm, failureText } from './TwoFactorParts';
import {
  disableTwoFactor,
  regenerateBackupCodes,
  startTwoFactorSetup,
  type TwoFactorSetup,
  type TwoFactorStatus,
} from './twoFactorApi';
import './twoFactor.css';

/** Что показывает раздел: подключение (n04d), коды один раз (n04e) или обычное состояние. */
export type TwoFactorView =
  | { readonly kind: 'idle' }
  | { readonly kind: 'setup'; readonly setup: TwoFactorSetup }
  | { readonly kind: 'codes'; readonly codes: readonly string[] };

export interface TwoFactorState {
  readonly load: Load<TwoFactorStatus>;
  readonly view: TwoFactorView;
  readonly setView: (view: TwoFactorView) => void;
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

/** Строка в «Вход» (n04f): выключена — «Включить»; включена — состояние и остаток кодов. */
export function TwoFactorRow({ state }: { readonly state: TwoFactorState }) {
  const { load, view, setView } = state;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (load.state !== 'ready' || view.kind !== 'idle') return null;
  async function start() {
    setBusy(true);
    setError(null);
    try {
      setView({ kind: 'setup', setup: await startTwoFactorSetup() });
    } catch (reason) {
      setError(failureText(reason, 'Подключение не началось'));
    } finally {
      setBusy(false);
    }
  }
  const { enabled, backupCodesLeft } = load.data;
  return (
    <li className="set-row">
      <div className="set-l">
        <span className="set-t">Двухфакторная защита</span>
        <span className="set-v">{enabled ? `включена · резервных кодов: ${backupCodesLeft}` : 'выключена'}</span>
        {error ? <ErrorLine text={error} /> : null}
      </div>
      {enabled ? null : (
        <div className="set-r">
          <button className="btn is-sm" type="button" disabled={busy} aria-busy={busy || undefined} onClick={() => void start()}>
            Включить
          </button>
        </div>
      )}
    </li>
  );
}

/** n04c: отключение спрашивает подтверждение и отправляет уже введённый код. */
function DisableDialog({ open, onClose, onConfirm }: { readonly open: boolean; readonly onClose: () => void; readonly onConfirm: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} title="Отключить двухфакторную защиту?">
      <div className="actions">
        <button className="btn is-danger" type="button" onClick={onConfirm}>
          Отключить
        </button>
        <button className="btn" type="button" onClick={onClose}>
          Оставить
        </button>
      </div>
    </Dialog>
  );
}

/** n04b/n04c: включённая защита — новые коды и отключение по коду из приложения или резервному. */
function EnabledPanel({ state }: { readonly state: TwoFactorState }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  async function run(action: () => Promise<void>, fallback: string) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (reason) {
      setError(failureText(reason, fallback));
    } finally {
      setBusy(false);
    }
  }
  const newCodes = () =>
    run(async () => state.setView({ kind: 'codes', codes: await regenerateBackupCodes(code) }), 'Коды не обновились');
  const disable = () =>
    run(async () => {
      setConfirming(false);
      await disableTwoFactor(code);
      state.load.retry();
    }, 'Защита не отключилась');
  const ready = code.trim().length > 0 && !busy;
  return (
    <li className="set-row is-block">
      <form className="c5-form" onSubmit={(event) => event.preventDefault()}>
        <CodeField label="Код из приложения-аутентификатора" value={code} onChange={setCode} />
        {error ? <ErrorLine text={error} /> : null}
        <div className="actions">
          <button className="btn" type="button" disabled={!ready} onClick={() => void newCodes()}>
            Показать новые коды
          </button>
          <button className="row-act is-danger" type="button" disabled={!ready} onClick={() => setConfirming(true)}>
            Отключить
          </button>
        </div>
      </form>
      <DisableDialog open={confirming} onClose={() => setConfirming(false)} onConfirm={() => void disable()} />
    </li>
  );
}

/** Отдельная группа под «Вход»: подключение, коды один раз или управление включённой защитой. */
export function TwoFactorPanel({ state }: { readonly state: TwoFactorState }) {
  const { load, view, setView } = state;
  if (view.kind === 'setup') {
    return (
      <Group title="Двухфакторная защита">
        <SetupForm
          setup={view.setup}
          onEnabled={(codes) => {
            setView({ kind: 'codes', codes });
            load.retry();
          }}
          onCancel={() => setView({ kind: 'idle' })}
        />
      </Group>
    );
  }
  if (view.kind === 'codes') {
    return (
      <Group title="Двухфакторная защита · включена">
        <BackupCodes
          codes={view.codes}
          onDone={() => {
            setView({ kind: 'idle' });
            load.retry();
          }}
        />
      </Group>
    );
  }
  if (load.state !== 'ready' || !load.data.enabled) return null;
  return (
    <Group title="Двухфакторная защита · включена">
      <EnabledPanel state={state} />
    </Group>
  );
}
