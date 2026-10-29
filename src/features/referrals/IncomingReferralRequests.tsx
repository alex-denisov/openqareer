import { useCallback, useEffect, useState } from 'react';
import { apiErrorMessage } from '../coach/apiClient';
import {
  answerReferralRequest,
  listIncomingReferralRequests,
  type IncomingReferralRequest,
} from './referralRequestApi';
import './referral-requests.css';

interface IncomingReferralRequestsViewProps {
  readonly items: readonly IncomingReferralRequest[];
  readonly busyId: string | null;
  readonly error: string | null;
  readonly onAnswer: (requestId: string, decision: 'accept' | 'decline') => void;
}

/**
 * B561 slice 3: requests to this member from candidates with a path through the
 * member's contacts. The member sees who asks and for which company, and decides.
 */
export function IncomingReferralRequestsView({
  items,
  busyId,
  error,
  onAnswer,
}: IncomingReferralRequestsViewProps) {
  if (items.length === 0) return null;
  return (
    <section className="referral-requests" aria-labelledby="referral-requests-title">
      <h2 id="referral-requests-title">Просят рекомендацию</h2>
      <ul className="referral-requests-list">
        {items.map((item) => (
          <ReferralRequestItem
            key={item.id}
            item={item}
            busy={busyId === item.id}
            onAnswer={onAnswer}
          />
        ))}
      </ul>
      {error ? <p role="alert">{error}</p> : null}
    </section>
  );
}

function ReferralRequestItem({
  item,
  busy,
  onAnswer,
}: {
  readonly item: IncomingReferralRequest;
  readonly busy: boolean;
  readonly onAnswer: IncomingReferralRequestsViewProps['onAnswer'];
}) {
  const { requester } = item;
  const contacts = item.contacts.map((person) =>
    person.roleTitle ? `${person.fullName} (${person.roleTitle})` : person.fullName,
  );
  return (
    <li className="referral-request">
      <p>
        <b>{requester.fullName}</b>
        {requester.headline ? `, ${requester.headline}` : ''} — в {item.companyName} на «
        {item.vacancyTitle}»
      </p>
      <p>Имя и заголовок указаны кандидатом в профиле и не проверены.</p>
      {contacts.length > 0 ? <p>Ваши контакты там: {contacts.join(', ')}</p> : null}
      {item.status === 'accepted' ? (
        <AcceptedNote linkedinUrl={requester.linkedinUrl} />
      ) : (
        <AnswerButtons requestId={item.id} busy={busy} onAnswer={onAnswer} />
      )}
    </li>
  );
}

function AcceptedNote({ linkedinUrl }: { readonly linkedinUrl: string | null }) {
  return (
    <p>
      Вы согласились познакомить.{' '}
      {linkedinUrl ? (
        <a href={linkedinUrl} target="_blank" rel="noreferrer noopener">
          Профиль LinkedIn
        </a>
      ) : (
        'Профиль LinkedIn кандидат не указал.'
      )}
    </p>
  );
}

function AnswerButtons({
  requestId,
  busy,
  onAnswer,
}: {
  readonly requestId: string;
  readonly busy: boolean;
  readonly onAnswer: IncomingReferralRequestsViewProps['onAnswer'];
}) {
  return (
    <div className="referral-request-actions">
      <button
        type="button"
        className="career-btn"
        disabled={busy}
        onClick={() => onAnswer(requestId, 'accept')}
      >
        Познакомить
      </button>
      <button
        type="button"
        className="career-btn is-ghost"
        disabled={busy}
        onClick={() => onAnswer(requestId, 'decline')}
      >
        Отказаться
      </button>
    </div>
  );
}

export function IncomingReferralRequests() {
  const [items, setItems] = useState<readonly IncomingReferralRequest[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try {
      setItems(await listIncomingReferralRequests());
    } catch {
      // The block is optional: without the list the screen stays as it was.
      setItems([]);
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);
  const onAnswer = useCallback(
    (requestId: string, decision: 'accept' | 'decline') => {
      setBusyId(requestId);
      setError(null);
      answerReferralRequest(requestId, decision)
        .then(reload)
        .catch((reason: unknown) =>
          setError(apiErrorMessage(reason, 'Не удалось сохранить ответ. Повторите попытку.')),
        )
        .finally(() => setBusyId(null));
    },
    [reload],
  );
  return (
    <IncomingReferralRequestsView items={items} busyId={busyId} error={error} onAnswer={onAnswer} />
  );
}
