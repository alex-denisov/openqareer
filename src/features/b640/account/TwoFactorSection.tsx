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

/** Строка в «Вход» (n04f): выключена — «Включить»; включена — «Отключить» (n04c). */
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
  const { enabled } = load.data;
  return (
    <li className="set-row">
      <div className="set-l">
        <span className="set-t">Двухфакторная защита</span>
        <span className="set-v">{enabled ? 'включена' : 'выключена'}</span>
        {error ? <ErrorLine text={error} /> : null}
      </div>
      {enabled ? (
        <CodeButton action="disable" label="Отключить" state={state} />
      ) : (
        <div className="set-r">
          <button className="btn is-sm" type="button" disabled={busy} aria-busy={busy || undefined} onClick={() => void start()}>
            Включить
          </button>
        </div>
      )}
    </li>
  );
}

type CodeAction = 'disable' | 'codes';

interface CodeDialogProps {
  readonly action: CodeAction;
  readonly state: TwoFactorState;
  readonly onClose: () => void;
}

/** n04c: окно отключения; код просим здесь же — без него сервер защиту не снимет. */
function CodeDialog({ action, state, onClose }: CodeDialogProps) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const disabling = action === 'disable';
  async function run() {
    setBusy(true);
    setError(null);
    try {
      if (disabling) await disableTwoFactor(code);
      else state.setView({ kind: 'codes', codes: await regenerateBackupCodes(code) });
      onClose();
      if (disabling) state.load.retry();
    } catch (reason) {
      setError(failureText(reason, disabling ? 'Защита не отключилась' : 'Коды не обновились'));
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      onClose={onClose}
      title={disabling ? 'Отключить двухфакторную защиту?' : 'Показать новые коды'}
    >
      <form
        className="c5-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (code.trim() && !busy) void run();
        }}
      >
        <CodeField label="Код из приложения-аутентификатора" value={code} onChange={setCode} />
        {error ? <ErrorLine text={error} /> : null}
        <div className="actions">
          <button
            className={disabling ? 'btn is-danger' : 'btn is-primary'}
            type="submit"
            disabled={!code.trim() || busy}
            aria-busy={busy || undefined}
          >
            {disabling ? 'Отключить' : 'Показать новые коды'}
          </button>
          <button className="btn" type="button" onClick={onClose}>
            {disabling ? 'Оставить' : 'Отмена'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

/** Кнопка строки, открывающая окно с кодом. */
function CodeButton({ action, label, state }: { readonly action: CodeAction; readonly label: string; readonly state: TwoFactorState }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="set-r">
      <button className="btn is-sm" type="button" onClick={() => setOpen(true)}>
        {label}
      </button>
      {open ? <CodeDialog action={action} state={state} onClose={() => setOpen(false)} /> : null}
    </div>
  );
}

/** Строка включённой защиты: сколько кодов осталось и новые коды. */
export function BackupCodesRow({ state }: { readonly state: TwoFactorState }) {
  const { load, view } = state;
  if (load.state !== 'ready' || view.kind !== 'idle' || !load.data.enabled) return null;
  return (
    <li className="set-row">
      <div className="set-l">
        <span className="set-t">Резервные коды</span>
        <span className="set-v">{`осталось: ${load.data.backupCodesLeft}`}</span>
      </div>
      <CodeButton action="codes" label="Новые коды" state={state} />
    </li>
  );
}

/** Отдельная группа под «Вход»: подключение, коды один раз. */
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
  return null;
}
