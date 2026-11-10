import { useState } from 'react';
import { ArrowSquareOut, Check } from '@phosphor-icons/react';
import { openExternalLink } from '../../services/desktop/openExternalLink';

/** What the letter needs to send the candidate on to the platform after approval (B629). */
export interface LetterPlatform {
  readonly url: string;
  readonly applied: boolean;
  /** Resolves once «Отклики» stored the mark; rejects when it could not be saved. */
  readonly onConfirmSent?: () => Promise<void>;
  /** B631: the approved text, copied before the platform opens so it can be pasted there. */
  readonly letterText?: string;
}

const SAVE_FAILED = 'Не удалось сохранить отклик. Состояние не изменено.';
const COPIED = 'Письмо скопировано. Вставьте его на площадке и отправьте отклик.';
const COPY_FAILED = 'Не удалось скопировать письмо: выделите текст выше и скопируйте вручную.';

function useConfirmSent(onConfirmSent?: () => Promise<void>) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const confirm = async () => {
    if (!onConfirmSent) return;
    setSaving(true);
    setError(undefined);
    try {
      await onConfirmSent();
    } catch {
      setError(SAVE_FAILED);
    } finally {
      setSaving(false);
    }
  };
  return { saving, error, confirm };
}

async function copyLetter(text?: string): Promise<boolean> {
  if (!text) return false;
  try {
    if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

type OpenState = 'idle' | 'copied' | 'copy-failed';

function useCopyAndOpen(platform?: LetterPlatform) {
  const [state, setState] = useState<OpenState>('idle');
  const [busy, setBusy] = useState(false);
  const run = async () => {
    if (!platform || busy) return;
    setBusy(true);
    // Both start inside the click: awaiting the clipboard first would spend the user activation
    // a browser needs to open the platform (WebKit blocks the window after an await).
    const copying = copyLetter(platform.letterText);
    void openExternalLink(platform.url);
    const copied = await copying;
    setState(copied ? 'copied' : 'copy-failed');
    setBusy(false);
  };
  return { state, busy, run };
}

function btnClass(primary: boolean): string {
  return `career-btn ${primary ? 'career-btn-primary' : 'career-btn-secondary'}`;
}

/**
 * B629/B631: after «Одобрить письмо» one road to the platform. The main action copies the letter
 * and opens the site; once it is open, «Отметить отправленным» leads. Opening the site is not a
 * response yet (B341), so the mark waits for the candidate. The approval already linked the letter
 * and the resume to the response card of this vacancy, so the mark carries both.
 */
export function LetterPlatformStep({ platform }: { readonly platform?: LetterPlatform }) {
  const open = useCopyAndOpen(platform);
  const sent = useConfirmSent(platform?.onConfirmSent);
  if (!platform?.url) return null;
  if (platform.applied) {
    return (
      <p className="career-letter-muted" role="status">
        <Check size={14} aria-hidden="true" /> Отклик отправлен: письмо и резюме привязаны к нему
      </p>
    );
  }
  const opened = open.state !== 'idle';
  return (
    <div className="career-letter-action-row">
      <button
        type="button"
        className={btnClass(!opened)}
        disabled={open.busy}
        onClick={() => void open.run()}
      >
        <ArrowSquareOut size={16} aria-hidden="true" />
        Скопировать письмо и открыть площадку
      </button>
      {platform.onConfirmSent ? (
        <button
          type="button"
          className={btnClass(opened)}
          disabled={sent.saving}
          onClick={() => void sent.confirm()}
        >
          <Check size={16} aria-hidden="true" />
          Отметить отправленным
        </button>
      ) : null}
      {opened ? (
        <p className="career-letter-muted" role="status">
          {open.state === 'copied' ? COPIED : COPY_FAILED}
        </p>
      ) : null}
      {sent.error ? <p role="alert">{sent.error}</p> : null}
    </div>
  );
}
