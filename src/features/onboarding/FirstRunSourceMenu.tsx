import { useRef, type ChangeEvent, type ReactElement } from 'react';
import { FolderOpen } from '@phosphor-icons/react';

export interface FirstRunSourceMenuProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onPickFile: (file: File) => void;
}

function SourceMenuActions({
  onPick,
  onClose,
}: {
  readonly onPick: () => void;
  readonly onClose: () => void;
}): ReactElement {
  return (
    <>
      <button
        type="button"
        className="first-run-pick-btn"
        data-testid="pick-files-btn"
        onClick={onPick}
      >
        <span className="first-run-source-menu-action-label">
          <FolderOpen size={18} />
          Выбрать в «Файлах»
        </span>
      </button>
      <button
        type="button"
        className="first-run-btn-ghost first-run-source-menu-cancel"
        onClick={onClose}
      >
        Отмена
      </button>
    </>
  );
}

function handleSelectedFile(
  event: ChangeEvent<HTMLInputElement>,
  onPickFile: (file: File) => void,
  onClose: () => void,
): void {
  const file = event.target.files?.[0];
  if (!file) return;
  onPickFile(file);
  onClose();
}

export function FirstRunSourceMenu({
  isOpen,
  onClose,
  onPickFile,
}: FirstRunSourceMenuProps): ReactElement | null {
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  return (
    <div
      className="first-run-modal-dim"
      role="dialog"
      aria-modal="true"
      aria-label="Выбор файла резюме"
      data-testid="first-run-source-menu"
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf,.pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx"
        className="first-run-native-file-input"
        data-testid="native-file-input"
        onChange={(event) => handleSelectedFile(event, onPickFile, onClose)}
      />
      <div className="first-run-sheet first-run-source-menu-sheet">
        <div className="first-run-source-menu-heading">
          <b>Загрузить резюме</b>
          <p>PDF или DOCX, до 10 МБ</p>
        </div>
        <SourceMenuActions onPick={() => fileInputRef.current?.click()} onClose={onClose} />
      </div>
    </div>
  );
}
