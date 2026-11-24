import { useState, type ReactNode } from 'react';
import {
  CAPABILITY_CONSENT_DOCUMENTS,
  capabilityConsentDocument,
  type CandidateCapability,
} from '../../legal/capabilityConsents';
import { Dialog } from '../kit/Dialog';
import { Icon } from '../kit/Icon';
import { ErrorLine } from './parts';

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

interface ConsentDialogProps {
  readonly capability: CandidateCapability;
  readonly open: boolean;
  readonly busy: boolean;
  readonly failed: boolean;
  readonly onGrant: () => void;
  readonly onClose: () => void;
}

/** Текст согласия; у данного согласия — той версии, которую кандидат принял. */
export function ConsentItems({ capability, versionId }: { readonly capability: CandidateCapability; readonly versionId?: string }) {
  return (
    <ul className="c5-list">
      {capabilityConsentDocument(capability, versionId).items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

/** Текст согласия перед выдачей: согласие даётся только после него. */
export function ConsentDialog({ capability, open, busy, failed, onGrant, onClose }: ConsentDialogProps) {
  return (
    <Dialog open={open} title={CAPABILITY_CONSENT_DOCUMENTS[capability].title} onClose={onClose}>
      <ConsentItems capability={capability} />
      {failed ? <ErrorLine text="Согласие не сохранилось" /> : null}
      <div className="actions">
        <button className="btn is-primary" type="button" disabled={busy} aria-busy={busy || undefined} onClick={onGrant}>
          <Icon name="check" />
          Дать согласие
        </button>
        <button className="btn" type="button" onClick={onClose}>
          Отмена
        </button>
      </div>
    </Dialog>
  );
}
