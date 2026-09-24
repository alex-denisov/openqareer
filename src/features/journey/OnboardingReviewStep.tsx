import type { ProfileReviewRow } from './profileFactReviewRows';

interface OnboardingReviewStepProps {
  readonly rows: readonly ProfileReviewRow[];
  /** The row currently open for a correction, if any. */
  readonly editingId?: string;
  readonly onStartEdit: (id: string, currentTitle: string) => void;
  readonly onCancelEdit: () => void;
  readonly draftValue: string;
  readonly onDraftChange: (value: string) => void;
  readonly onSaveEdit: (id: string) => void;
}

/**
 * Step 3, "Проверьте профиль" (onboarding.html): one screen, every fact, its
 * source, and an in-place way to fix a single item without re-answering
 * everything (mockup-data-gap.md, "Онбординг" §3 — this is also where the
 * "неизвестные, которые сильнее всего изменят картину" diagnostic is meant to
 * live, per CPO decision).
 */
export function OnboardingReviewStep(props: OnboardingReviewStepProps) {
  if (props.rows.length === 0) {
    return (
      <p className="career-inline-note">
        Пока нечего проверять — на предыдущем шаге не нашлось фактов для профиля.
      </p>
    );
  }
  return (
    <div className="career-onboarding-review-list">
      {props.rows.map((row) =>
        props.editingId === row.id ? (
          <ReviewEditRow
            key={row.id}
            row={row}
            draftValue={props.draftValue}
            onDraftChange={props.onDraftChange}
            onCancelEdit={props.onCancelEdit}
            onSaveEdit={props.onSaveEdit}
          />
        ) : (
          <ReviewRow key={row.id} row={row} onStartEdit={props.onStartEdit} />
        ),
      )}
    </div>
  );
}

function ReviewRow({
  row,
  onStartEdit,
}: {
  row: ProfileReviewRow;
  onStartEdit: (id: string, currentTitle: string) => void;
}) {
  return (
    <div className="career-onboarding-review-item">
      <div>
        <div className="career-onboarding-review-role">{row.title}</div>
        <div className="career-onboarding-review-sub">{row.subtitle}</div>
        {row.tag ? (
          <span className={`tag tag-${row.tag.tone}`}>{row.tag.label}</span>
        ) : null}
      </div>
      <button
        type="button"
        className="career-quiet-button"
        onClick={() => onStartEdit(row.id, row.title)}
      >
        Исправить
      </button>
    </div>
  );
}

function ReviewEditRow({
  row,
  draftValue,
  onDraftChange,
  onCancelEdit,
  onSaveEdit,
}: {
  row: ProfileReviewRow;
  draftValue: string;
  onDraftChange: (value: string) => void;
  onCancelEdit: () => void;
  onSaveEdit: (id: string) => void;
}) {
  return (
    <div className="career-onboarding-review-item is-editing">
      <label className="career-onboarding-review-edit">
        <span>Исправление для «{row.title}»</span>
        <textarea
          value={draftValue}
          onChange={(event) => onDraftChange(event.target.value)}
          rows={2}
        />
      </label>
      <div className="career-onboarding-review-edit-actions">
        <button type="button" className="career-quiet-button" onClick={onCancelEdit}>
          Отмена
        </button>
        <button
          type="button"
          className="career-primary-button"
          onClick={() => onSaveEdit(row.id)}
        >
          Сохранить
        </button>
      </div>
    </div>
  );
}
