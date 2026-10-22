import { PencilSimple } from '@phosphor-icons/react';
import { useVacancyLetterController } from './vacancyLetterController';

function DraftBody({ state }: { readonly state: ReturnType<typeof useVacancyLetterController> }) {
  const { draft } = state;
  if (draft.loading)
    return (
      <p className="vacancy-push-quote" role="status">
        Консультант готовит черновик…
      </p>
    );
  if (draft.error)
    return (
      <div className="vacancy-push-quote" role="alert">
        <p>{draft.error}</p>
        <button type="button" className="vacancy-push-text" onClick={draft.retry}>
          Повторить
        </button>
      </div>
    );
  return <p className="vacancy-push-quote">{draft.text}</p>;
}

function DraftNote({
  approval,
}: {
  readonly approval: ReturnType<typeof useVacancyLetterController>['approval'];
}) {
  return (
    <>
      <p className="vacancy-push-foot">
        {approval.saved
          ? 'Сообщение одобрено и сохранено в «Откликах». Ничего не отправлено.'
          : 'Черновик подготовил консультант. Ничего не отправится без вашего одобрения.'}
      </p>
      {approval.error ? (
        <p className="vacancy-push-foot" role="alert">
          {approval.error}
        </p>
      ) : null}
    </>
  );
}

/**
 * «Черновик сообщения Ирине» (mockup 4, 390, круг 1; G5 R3): the same draft and approval as
 * «Письмо под вакансию» on circle 1. Approval saves an unsent snapshot; nothing is sent here.
 */
export function PushCircleOneDraft({
  vacancyId,
  onEdit,
}: {
  readonly vacancyId: string;
  readonly onEdit?: () => void;
}) {
  const state = useVacancyLetterController(vacancyId, 1);
  const recipient = state.circle.selectedPath?.recipient;
  if (!recipient) return null;
  const { approval, draft } = state;
  return (
    <>
      <section className="vacancy-push-group">
        <h3 className="vacancy-push-cap">Черновик сообщения · {recipient.fullName}</h3>
        <div className="vacancy-push-list">
          <DraftBody state={state} />
        </div>
        <DraftNote approval={approval} />
      </section>
      <div className="vacancy-push-cta">
        <button
          type="button"
          className="vacancy-push-primary"
          disabled={approval.busy || Boolean(approval.saved) || draft.loading || !draft.text.trim()}
          onClick={() => void approval.approve()}
        >
          {approval.saved ? 'Одобрено' : 'Одобрить и отправить'}
        </button>
        {onEdit ? (
          <button
            type="button"
            className="vacancy-push-round"
            aria-label="Править"
            onClick={onEdit}
          >
            <PencilSimple size={20} aria-hidden="true" />
          </button>
        ) : null}
      </div>
    </>
  );
}
