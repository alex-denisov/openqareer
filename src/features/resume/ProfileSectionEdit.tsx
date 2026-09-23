import { PencilSimple, Plus, Trash } from '@phosphor-icons/react';

/**
 * Every section carries a working pencil (B265 owner remark #7) — never a
 * disabled placeholder. Clicking it is the only way in; there is no separate
 * "enabled" state to fake.
 */
export function SectionPencilButton({
  label,
  onClick,
}: {
  readonly label: string;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="career-profile-screen-icon-button"
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      <PencilSimple size={14} />
    </button>
  );
}

export function SectionAddButton({
  label,
  onClick,
}: {
  readonly label: string;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="career-profile-screen-icon-button"
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      <Plus size={14} />
    </button>
  );
}

export function SectionRemoveButton({
  label,
  onClick,
}: {
  readonly label: string;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="career-profile-screen-icon-button is-danger"
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      <Trash size={14} />
    </button>
  );
}

/**
 * The Save action lives inside the section's own edit mode, not a permanent
 * header button (B265 owner remark #5) — it only exists while there is
 * something open to save.
 */
export function SectionEditActions({
  saving,
  onCancel,
  onSave,
}: {
  readonly saving?: boolean;
  readonly onCancel: () => void;
  readonly onSave: () => void;
}) {
  return (
    <div className="career-profile-screen-edit-actions">
      <button type="button" className="career-quiet-button" onClick={onCancel}>
        Отменить
      </button>
      <button type="button" className="career-primary-button" disabled={saving} onClick={onSave}>
        {saving ? 'Сохраняем…' : 'Сохранить'}
      </button>
    </div>
  );
}
