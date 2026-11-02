import { ChatCircleText, Check } from '@phosphor-icons/react';
import type { ApprovalState } from './vacancyLetterController';

function ApprovedLetterActions({
  onOpenResponses,
  approvedAt,
}: {
  readonly onOpenResponses?: () => void;
  readonly approvedAt: string;
}) {
  const date = new Date(approvedAt);
  const dateLabel = Number.isNaN(date.getTime())
    ? ''
    : new Intl.DateTimeFormat('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      }).format(date);
  return (
    <div className="career-letter-approved" role="status">
      <Check size={16} aria-hidden="true" />
      <span>
        Письмо одобрено
        {dateLabel ? (
          <>
            {' '}
            <time dateTime={approvedAt}>{dateLabel}</time>
          </>
        ) : null}
        . Заявка сохранена в «Откликах». Ничего не отправлено.
      </span>
      {onOpenResponses ? (
        <button type="button" className="career-btn career-btn-secondary" onClick={onOpenResponses}>
          Отклики
        </button>
      ) : null}
    </div>
  );
}

function DraftLetterActions({
  approval,
  pitchReady,
  onAskEdits,
}: {
  readonly approval: ApprovalState;
  readonly pitchReady: boolean;
  readonly onAskEdits?: () => void;
}) {
  return (
    <div className="career-letter-action-row">
      <button
        type="button"
        className="career-btn career-btn-primary"
        disabled={!pitchReady}
        aria-busy={approval.busy}
        onClick={() => void approval.approve()}
      >
        <Check size={16} aria-hidden="true" />
        {approval.busy ? 'Сохраняем снимок…' : 'Одобрить письмо'}
      </button>
      {onAskEdits ? (
        <button type="button" className="career-btn career-btn-secondary" onClick={onAskEdits}>
          <ChatCircleText size={16} aria-hidden="true" />
          Попросить правки
        </button>
      ) : (
        <span className="career-letter-muted">Консультант недоступен из этого раздела.</span>
      )}
    </div>
  );
}

export function LetterActions({
  approval,
  pitchReady,
  onAskEdits,
  onOpenResponses,
}: {
  readonly approval: ApprovalState;
  readonly pitchReady: boolean;
  readonly onAskEdits?: () => void;
  readonly onOpenResponses?: () => void;
}) {
  return (
    <footer className="career-letter-actions">
      {approval.error ? <p role="alert">{approval.error}</p> : null}
      {approval.saved ? (
        <ApprovedLetterActions
          onOpenResponses={onOpenResponses}
          approvedAt={approval.saved.approvedAt}
        />
      ) : (
        <DraftLetterActions approval={approval} pitchReady={pitchReady} onAskEdits={onAskEdits} />
      )}
      {!approval.saved ? (
        <p className="career-letter-footnote">
          Черновик, ничего не отправлено. Отправка возможна только из очереди, после вашего
          одобрения.
        </p>
      ) : null}
    </footer>
  );
}
