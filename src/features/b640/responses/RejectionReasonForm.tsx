import { useCallback, useId, useState } from 'react';
import {
  REJECTION_NOTE_MAX_LENGTH,
  REJECTION_REASONS,
  REJECTION_REASON_LABELS,
  type RejectionReason,
  type RejectionReviewItem,
} from '../../../../shared/rejectionReview';
import { apiErrorMessage } from '../../coach/apiClient';
import { Button, Link, ResultLine, StatusLine } from '../kit';
import { buildNodePath } from '../routes';
import { getRejectionReview, saveRejectionReason } from './data/rejectionReviewApi';
import { useAsync } from './data/useAsync';
import { guessLine } from './model/reviewText';

type Saving =
  | { readonly kind: 'idle' | 'busy' | 'done' }
  | { readonly kind: 'error'; readonly text: string };

interface ChipsProps {
  readonly labelId: string;
  readonly reason: RejectionReason | null;
  readonly onPick: (reason: RejectionReason) => void;
}

function ReasonChips({ labelId, reason, onPick }: ChipsProps) {
  return (
    <div className="chips" role="group" aria-labelledby={labelId}>
      {REJECTION_REASONS.map((value) => (
        <button
          className="chip"
          type="button"
          key={value}
          aria-pressed={reason === value}
          onClick={() => onPick(value)}
        >
          {REJECTION_REASON_LABELS[value]}
        </button>
      ))}
    </div>
  );
}

interface FormProps {
  readonly labelId: string;
  readonly applicationId: string;
  readonly item: RejectionReviewItem | null;
}

interface NoteFieldProps {
  readonly id: string;
  readonly note: string;
  readonly onChange: (value: string) => void;
}

function NoteField({ id, note, onChange }: NoteFieldProps) {
  return (
    <div className="field">
      <label htmlFor={id}>
        Что написали <span className="au3-opt">необязательно</span>
      </label>
      <textarea
        id={id}
        value={note}
        maxLength={REJECTION_NOTE_MAX_LENGTH}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    </div>
  );
}

function ReasonFields({ labelId, applicationId, item }: FormProps) {
  const id = useId();
  const [reason, setReason] = useState<RejectionReason | null>(item?.candidateReason?.reason ?? null);
  const [note, setNote] = useState(item?.candidateReason?.note ?? '');
  const [saving, setSaving] = useState<Saving>({ kind: 'idle' });

  function save() {
    if (!reason) {
      setSaving({ kind: 'error', text: 'Выберите, чего не хватило.' });
      return;
    }
    setSaving({ kind: 'busy' });
    saveRejectionReason(applicationId, reason, note.trim() || null)
      .then(() => setSaving({ kind: 'done' }))
      .catch((error: unknown) =>
        setSaving({ kind: 'error', text: apiErrorMessage(error, 'Не получилось сохранить. Повторите.') }),
      );
  }

  return (
    <>
      <ReasonChips
        labelId={labelId}
        reason={reason}
        onPick={(value) => {
          setReason(value);
          setSaving({ kind: 'idle' });
        }}
      />
      <NoteField
        id={`${id}-note`}
        note={note}
        onChange={(value) => {
          setNote(value);
          setSaving({ kind: 'idle' });
        }}
      />
      <div className="actions">
        <Button icon="check" busy={saving.kind === 'busy'} onClick={save}>
          Отметить, чего не хватило
        </Button>
      </div>
      {saving.kind === 'done' ? <ResultLine text="Отмечено" /> : null}
      {saving.kind === 'error' ? <StatusLine state="err" text={saving.text} /> : null}
      <Link className="row-act" to={buildNodePath('o07')}>
        Что исправить
      </Link>
    </>
  );
}

/**
 * Отказ в раскрытом отклике (O5): догадка «вероятно, не хватило» и отметка кандидата.
 * Догадка не загрузилась — отметить причину всё равно можно.
 */
export function RejectionReasonForm({ applicationId }: { readonly applicationId: string }) {
  const labelId = useId();
  const load = useCallback((signal: AbortSignal) => getRejectionReview(signal), []);
  const { state } = useAsync(load, 'Разбор не загрузился.');
  if (state.status === 'loading' && !state.data) {
    return (
      <p className="ls-state" role="status">
        Загружаем разбор…
      </p>
    );
  }
  const item = state.data?.rejections.find((entry) => entry.applicationId === applicationId) ?? null;
  return (
    <div className="od-was">
      <h4 id={labelId}>Как думаете, чего не хватило?</h4>
      {item?.guess ? <p>{guessLine(item.guess)}</p> : null}
      <ReasonFields labelId={labelId} applicationId={applicationId} item={item} />
    </div>
  );
}
