import { useState } from 'react';
import { ArrowSquareOut, Check } from '@phosphor-icons/react';
import { openExternalLink } from '../../services/desktop/openExternalLink';

/** What the letter needs to send the candidate on to the platform after approval (B629). */
export interface LetterPlatform {
  readonly url: string;
  readonly applied: boolean;
  /** Resolves once «Отклики» stored the mark; rejects when it could not be saved. */
  readonly onConfirmSent?: () => Promise<void>;
}

/**
 * B629: after «Одобрить письмо» the way to the platform. Opening the site is not a response yet
 * (B341), so the mark waits for «Да, отклик отправлен». Without a link there is no step at all.
 */
const SAVE_FAILED = 'Не удалось сохранить отклик. Состояние не изменено.';

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

export function LetterPlatformStep({ platform }: { readonly platform?: LetterPlatform }) {
  const [opened, setOpened] = useState(false);
  const sent = useConfirmSent(platform?.onConfirmSent);
  if (!platform?.url) return null;
  if (platform.applied) {
    return (
      <p className="career-letter-muted" role="status">
        <Check size={14} aria-hidden="true" /> Отклик отмечен
      </p>
    );
  }
  return (
    <div className="career-letter-action-row">
      <button
        type="button"
        className={`career-btn ${opened ? 'career-btn-secondary' : 'career-btn-primary'}`}
        onClick={() => {
          void openExternalLink(platform.url);
          setOpened(true);
        }}
      >
        <ArrowSquareOut size={16} aria-hidden="true" />
        Открыть площадку
      </button>
      {opened && platform.onConfirmSent ? (
        <>
          <span className="career-letter-muted">Отклик отправлен?</span>
          <button
            type="button"
            className="career-btn career-btn-primary"
            disabled={sent.saving}
            onClick={() => void sent.confirm()}
          >
            <Check size={16} aria-hidden="true" />
            Да, отклик отправлен
          </button>
        </>
      ) : null}
      {sent.error ? <p role="alert">{sent.error}</p> : null}
    </div>
  );
}
