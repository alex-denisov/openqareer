import { useState, type ReactNode } from 'react';
import { Dialog } from '../kit/Dialog';

/** Общие части строк согласий n05: действие с ожиданием и переключатель. */

/** Действие с ожиданием и ошибкой на месте. */
export function useAction(onDone: () => void) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setFailed(false);
    try {
      await action();
      onDone();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }
  return { busy, failed, run: (action: () => Promise<unknown>) => void run(action) };
}

interface ConsentSwitchProps {
  readonly label: string;
  readonly checked: boolean;
  readonly disabled: boolean;
  readonly onChange: (checked: boolean) => void;
}

export function ConsentSwitch({ label, checked, disabled, onChange }: ConsentSwitchProps) {
  return (
    <div className="set-r">
      <span className="sw-cell">
        <input
          className="sw"
          type="checkbox"
          role="switch"
          aria-label={label}
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.currentTarget.checked)}
        />
      </span>
    </div>
  );
}

interface ConsentTextLinkProps {
  readonly title: string;
  readonly children: ReactNode;
}

/** «Текст согласия» под уже данным согласием: тот же текст для чтения, без кнопки выдачи (B774). */
export function ConsentTextLink({ title, children }: ConsentTextLinkProps) {
  const [open, setOpen] = useState(false);
  return (
    <span>
      <button className="row-act" type="button" onClick={() => setOpen(true)}>
        Текст согласия
      </button>
      <Dialog open={open} title={title} onClose={() => setOpen(false)}>
        {children}
      </Dialog>
    </span>
  );
}
