import { useEffect, useRef, useState } from 'react';
import { LINKEDIN_VARIANTS_MAX, type LinkedinOffer } from '../../../../../shared/b640LinkedinProfile';
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
  /** Идёт «Отметить все выполненными»: варианты на это время не просятся. */
  readonly locked?: boolean;
}

/** «‹ Вариант 2 из 3 ›»: у единственного текста листать нечего. */
function VariantSwitch({ label, index, total, onSelect }: {
  readonly label: string;
  readonly index: number;
  readonly total: number;
  readonly onSelect: (index: number) => void;
}) {
  if (total < 2) return null;
  return (
    <div className="var-sw" role="group" aria-label={`Варианты: ${label}`}>
      <button className="icon-btn" type="button" aria-label="Предыдущий вариант" disabled={index === 0} onClick={() => onSelect(index - 1)}>
        <Icon name="left" />
      </button>
      <span className="num">{`Вариант ${index + 1} из ${LINKEDIN_VARIANTS_MAX}`}</span>
      <button className="icon-btn" type="button" aria-label="Следующий вариант" disabled={index >= total - 1} onClick={() => onSelect(index + 1)}>
        <Icon name="right" />
      </button>
    </div>
  );
}

/** Показанный вариант: по умолчанию последний; новый вариант сразу на экране. */
function useShownVariant(offer: LinkedinOffer) {
  const total = offer.variants.length;
  const [picked, setPicked] = useState({ total, index: total - 1 });
  const index = picked.total === total ? picked.index : total - 1;
  return { index, text: offer.variants[index] ?? '', select: (next: number) => setPicked({ total, index: next }) };
}

const VARIANT_FAILED = 'Не получилось предложить другой вариант';
const DONE_FAILED = 'Не удалось сохранить отметку';

function errorText(error: unknown, fallback: string): string {
  // Варианты кончились или ещё готовятся — сервер говорит своими словами.
  const own = error instanceof CoachApiError && ['variant_limit_reached', 'variant_in_progress', 'variant_attempts_exhausted'].includes(error.code);
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

function DoneControl({ offer, label, textId, busy, onDone }: {
  readonly offer: LinkedinOffer;
  readonly label: string;
  readonly textId: string;
  readonly busy: boolean;
  readonly onDone: () => void;
}) {
  const status = useRef<HTMLSpanElement>(null);
  const pressed = useRef(false);
  // Фокус с исчезнувшей кнопки — на отметку, а не в начало страницы.
  useEffect(() => {
    if (offer.doneAt && pressed.current) status.current?.focus();
  }, [offer.doneAt]);
  if (offer.doneAt) {
    return (
      <span className="li-done" role="status" tabIndex={-1} ref={status}>
        <Icon name="check" />
        Выполнено
      </span>
    );
  }
  return (
    <button
      className="btn is-sm"
      type="button"
      aria-label={`Выполнено: ${label}`}
      aria-describedby={textId}
      aria-busy={busy || undefined}
      disabled={busy}
      onClick={() => {
        pressed.current = true;
        onDone();
      }}
    >
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
  const shown = useShownVariant(offer);
  const left = Math.max(0, LINKEDIN_VARIANTS_MAX - offer.variants.length);
  const textId = `li-new-${offer.key.replace(/[^A-Za-z0-9_-]/gu, '-')}`;
  return (
    <>
      <div className="li-offer">
        <p className="li-new" id={textId} aria-live="polite">
          {shown.text}
        </p>
        <div className="li-offer-a">
          <VariantSwitch label={label} index={shown.index} total={offer.variants.length} onSelect={shown.select} />
          <CopyButton text={shown.text} label={label} />
          <button
            className="icon-btn li-alt"
            type="button"
            aria-label={`Другой вариант: ${label} · осталось ${left}`}
            aria-busy={busy === 'variant' || undefined}
            disabled={busy !== null || props.locked === true || left === 0}
            onClick={() => void run('variant')}
          >
            <Icon name="refresh" />
          </button>
          <DoneControl offer={offer} label={label} textId={textId} busy={busy === 'done'} onDone={() => void run('done')} />
        </div>
      </div>
      {failed ? <LiError text={failed.text} onRetry={() => void run(failed.kind)} /> : null}
    </>
  );
}
