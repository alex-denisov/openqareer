import { Icon } from '../../kit';

export interface SaveButtonProps {
  readonly saved: boolean;
  readonly busy: boolean;
  readonly onToggle: () => void;
  /** Копия в углу шапки на 390; на широком экране виден только значок в строке действий. */
  readonly mobile?: boolean;
}

export function SaveButton({ saved, busy, onToggle, mobile = false }: SaveButtonProps) {
  return (
    <button
      className={mobile ? 'icon-btn v4-save v4-save-m' : 'icon-btn v4-save'}
      type="button"
      aria-pressed={saved}
      aria-label="Сохранить"
      aria-busy={busy || undefined}
      disabled={busy}
      onClick={onToggle}
    >
      <Icon name="bookmark" />
    </button>
  );
}
