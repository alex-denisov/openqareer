import { useState } from 'react';
import type { LinkedinOffer } from '../../../../../shared/b640LinkedinProfile';
import { CoachApiError } from '../../../coach/apiClient';
import { Icon } from '../../kit';
import { CopyButton } from './CopyButton';
import { LiError } from './LiError';
import { requestOfferVariant } from './linkedinProfileApi';

type Busy = 'done' | 'variant' | null;

interface SectionOfferProps {
  readonly offer: LinkedinOffer;
  /** Название в подписях кнопок: раздел или «Компания» места работы. */
  readonly label: string;
  readonly onDone: (key: string) => Promise<void>;
  readonly onVariant: (offer: LinkedinOffer) => void;
}

const VARIANT_FAILED = 'Не получилось предложить другой вариант';
const DONE_FAILED = 'Не удалось сохранить отметку';

function errorText(error: unknown, fallback: string): string {
  // Кончилась квота тарифа или варианты — сервер сам говорит, что и где взять ещё.
  const own = error instanceof CoachApiError && ['quota_exhausted', 'variant_limit_reached'].includes(error.code);
  return own ? error.message : fallback;
}

function useOfferActions({ offer, onDone, onVariant }: SectionOfferProps) {
  const [busy, setBusy] = useState<Busy>(null);
  const [failed, setFailed] = useState<{ readonly kind: Exclude<Busy, null>; readonly text: string } | null>(null);
  async function run(kind: Exclude<Busy, null>) {
    setBusy(kind);
    setFailed(null);
    try {
      if (kind === 'done') await onDone(offer.key);
      else onVariant(await requestOfferVariant(offer.key));
    } catch (error) {
      setFailed({ kind, text: errorText(error, kind === 'done' ? DONE_FAILED : VARIANT_FAILED) });
    } finally {
      setBusy(null);
    }
  }
  return { busy, failed, run };
}

function DoneControl({ offer, textId, busy, onDone }: {
  readonly offer: LinkedinOffer;
  readonly textId: string;
  readonly busy: boolean;
  readonly onDone: () => void;
}) {
  if (offer.doneAt) {
    return (
      <span className="li-done" role="status">
        <Icon name="check" />
        Выполнено
      </span>
    );
  }
  return (
    <button className="btn is-sm" type="button" aria-describedby={textId} aria-busy={busy || undefined} disabled={busy} onClick={onDone}>
      <Icon name="check" />
      Выполнено
    </button>
  );
}

/**
 * Предложение по разделу (a03): «Скопировать», «Предложить заново», «Выполнено». На LinkedIn ничего
 * не уходит: кандидат вставляет текст сам и подтверждает «Выполнено».
 */
export function SectionOffer(props: SectionOfferProps) {
  const { offer, label } = props;
  const { busy, failed, run } = useOfferActions(props);
  const textId = `li-new-${offer.key.replace(/[^A-Za-z0-9_-]/gu, '-')}`;
  return (
    <>
      <div className="li-offer">
        <p className="li-new" id={textId}>
          {offer.text}
        </p>
        <div className="li-offer-a">
          <CopyButton text={offer.text} label={label} />
          <button
            className="icon-btn li-alt"
            type="button"
            aria-label={`Другой вариант: ${label} · осталось ${offer.variantsLeft}`}
            aria-busy={busy === 'variant' || undefined}
            disabled={busy !== null || offer.variantsLeft === 0}
            onClick={() => void run('variant')}
          >
            <Icon name="refresh" />
          </button>
          <DoneControl offer={offer} textId={textId} busy={busy === 'done'} onDone={() => void run('done')} />
        </div>
      </div>
      {failed ? <LiError text={failed.text} onRetry={() => void run(failed.kind)} /> : null}
    </>
  );
}
