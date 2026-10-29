import { useCallback, useState } from 'react';
import { apiErrorMessage } from '../coach/apiClient';
import { requestReferral } from '../referrals/referralRequestApi';
import type { PathCircleCard } from './vacancyPathCircles';

export interface ReferralAskState {
  readonly sent: boolean;
  readonly busy: boolean;
  readonly error: string | null;
  readonly ask: () => void;
}

/** B561 slice 3: one «Попросить рекомендацию» request for the vacancy's company. */
export function useReferralAsk(vacancyId: string): ReferralAskState {
  const [sentFor, setSentFor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ask = useCallback(() => {
    setBusy(true);
    setError(null);
    requestReferral(vacancyId)
      .then(() => setSentFor(vacancyId))
      .catch((reason: unknown) =>
        setError(apiErrorMessage(reason, 'Не удалось отправить запрос. Повторите попытку.')),
      )
      .finally(() => setBusy(false));
  }, [vacancyId]);
  return { sent: sentFor === vacancyId, busy, error, ask };
}

/** Under circle 2: what the members will see before asking, and the introducers once accepted. */
export function CircleReferralDetails({
  card,
  referral,
  showAskButton,
}: {
  readonly card: PathCircleCard;
  readonly referral: ReferralAskState;
  readonly showAskButton: boolean;
}) {
  const introducers = card.result?.platformReferral?.introducers ?? [];
  return (
    <>
      {card.referralAction === 'ask' ? (
        <p>
          Участники, у которых есть путь в компанию, увидят ваше имя, заголовок и вакансию. Профиль
          LinkedIn — только тем, кто согласится познакомить.
        </p>
      ) : null}
      {card.referralAction === 'ask' && showAskButton ? (
        <button type="button" className="vac-sm" disabled={referral.busy} onClick={referral.ask}>
          Попросить рекомендацию
        </button>
      ) : null}
      {introducers.map((item) => (
        <p key={item.fullName + (item.linkedinUrl ?? '')}>
          {item.linkedinUrl ? (
            <a href={item.linkedinUrl} target="_blank" rel="noreferrer noopener">
              {item.fullName}
            </a>
          ) : (
            item.fullName
          )}
          {item.headline ? `, ${item.headline}` : ''}
          {item.people.length > 0
            ? ` знает: ${item.people.map((person) => person.fullName).join(', ')}`
            : ''}
        </p>
      ))}
      {referral.error ? <p role="alert">{referral.error}</p> : null}
    </>
  );
}
