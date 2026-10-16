import { useEffect, useRef, useState, type ChangeEvent, type ReactElement } from 'react';
import { FolderOpen, Image, Scan } from '@phosphor-icons/react';

export interface FirstRunSourceMenuProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onPickFile: (file: File) => void;
}

const MENU_OPTIONS = [
  { kind: 'file', testId: 'pick-files-btn', Icon: FolderOpen, label: 'Выбрать в «Файлах»' },
  { kind: 'photo', testId: 'pick-photo-btn', Icon: Image, label: 'Фото из библиотеки' },
  { kind: 'scan', testId: 'scan-doc-btn', Icon: Scan, label: 'Сканировать документ' },
] as const;

type UnavailableAction = 'photo' | 'scan';

function SourceMenuActions({
  onPick,
  onUnavailable,
  onClose,
}: {
  readonly onPick: () => void;
  readonly onUnavailable: (action: UnavailableAction) => void;
  readonly onClose: () => void;
}): ReactElement {
  return (
    <>
      {MENU_OPTIONS.map(({ kind, testId, Icon, label }) => (
        <button
          key={testId}
          type="button"
          className="first-run-pick-btn"
          data-testid={testId}
          onClick={() => (kind === 'file' ? onPick() : onUnavailable(kind))}
        >
          <span className="first-run-source-menu-action-label">
            <Icon size={18} />
            {label}
          </span>
        </button>
      ))}
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

function unavailableActionCopy(action: UnavailableAction): string {
  return action === 'photo'
    ? 'Загрузка фотографий пока недоступна. Выберите PDF-резюме.'
    : 'Сканирование пока недоступно. Выберите PDF-резюме.';
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
  const [unavailableAction, setUnavailableAction] = useState<UnavailableAction | null>(null);
  useEffect(() => {
    if (isOpen) setUnavailableAction(null);
  }, [isOpen]);

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
        {unavailableAction ? (
          <p className="first-run-source-menu-notice" role="status">
            {unavailableActionCopy(unavailableAction)}
          </p>
        ) : null}
        <SourceMenuActions
          onPick={() => {
            setUnavailableAction(null);
            fileInputRef.current?.click();
          }}
          onUnavailable={setUnavailableAction}
          onClose={onClose}
        />
      </div>
    </div>
  );
}
