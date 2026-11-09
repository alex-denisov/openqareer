import { useState } from 'react';
import { ArrowSquareOut, Check } from '@phosphor-icons/react';
import { openExternalLink } from '../../services/desktop/openExternalLink';

/** What the letter needs to send the candidate on to the platform after approval (B629). */
export interface LetterPlatform {
  readonly url: string;
  readonly applied: boolean;
  readonly onConfirmSent?: () => void;
}

/**
 * B629: after «Одобрить письмо» the way to the platform. Opening the site is not a response yet
 * (B341), so the mark waits for «Да, отклик отправлен». Without a link there is no step at all.
 */
export function LetterPlatformStep({ platform }: { readonly platform?: LetterPlatform }) {
  const [opened, setOpened] = useState(false);
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
            onClick={platform.onConfirmSent}
          >
            <Check size={16} aria-hidden="true" />
            Да, отклик отправлен
          </button>
        </>
      ) : null}
    </div>
  );
}
