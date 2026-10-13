import { useRef, type ReactElement } from 'react';
import { FolderOpen, Image, Scan } from '@phosphor-icons/react';

export interface FirstRunSourceMenuProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onPickFile: (file: File) => void;
}

const MENU_OPTIONS = [
  { testId: 'pick-files-btn', Icon: FolderOpen, label: 'Выбрать в «Файлах»' },
  { testId: 'pick-photo-btn', Icon: Image, label: 'Фото из библиотеки' },
  { testId: 'scan-doc-btn', Icon: Scan, label: 'Сканировать документ' },
] as const;

function SourceMenuActions({
  onPick,
  onClose,
}: {
  readonly onPick: () => void;
  readonly onClose: () => void;
}): ReactElement {
  return (
    <>
      {MENU_OPTIONS.map(({ testId, Icon, label }) => (
        <button
          key={testId}
          type="button"
          className="first-run-pick-btn"
          data-testid={testId}
          onClick={onPick}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Icon size={18} />
            {label}
          </span>
        </button>
      ))}
      <button
        type="button"
        className="first-run-btn-ghost"
        style={{ width: '100%', marginTop: '8px' }}
        onClick={onClose}
      >
        Отмена
      </button>
    </>
  );
}

export function FirstRunSourceMenu({
  isOpen,
  onClose,
  onPickFile,
}: FirstRunSourceMenuProps): ReactElement | null {
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onPickFile(file);
      onClose();
    }
  };

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
        accept=".pdf,.docx,image/*"
        style={{ display: 'none' }}
        data-testid="native-file-input"
        onChange={handleFileChange}
      />
      <div className="first-run-sheet" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <div style={{ marginBottom: '8px' }}>
          <b style={{ fontSize: 'var(--career-text-sm, 14px)' }}>Загрузить резюме</b>
          <p style={{ margin: '4px 0 0', fontSize: 'var(--career-text-xs, 12px)', color: 'var(--career-color-sub, #64748b)' }}>
            PDF или DOCX, до 10 МБ
          </p>
        </div>
        <SourceMenuActions onPick={() => fileInputRef.current?.click()} onClose={onClose} />
      </div>
    </div>
  );
}
