import { useState } from 'react';
import { HhConnectModal } from '../../connections/HhConnectModal';
import type { NativeImportMode } from '../../resume/resumeApi';
import type { ParsedResume } from '../../workspace/resumeParser';
import { connectHhFromSession } from './hhResumeSession';

/** Признак флажка a11b «Импортировать данные из резюме»: `import=1` — профиль, `import=0` — только подключение. */
export function hhImportMode(search: string): NativeImportMode | null {
  const value = new URLSearchParams(search).get('import');
  if (value === '1') return 'profile';
  return value === '0' ? 'connect_only' : null;
}

interface HhConnectActionProps {
  /** Подключение сохранено: строка перечитывается. */
  readonly onConnected: () => void;
  /** Вход выполнен, а резюме на hh.ru нет: окно закрылось, итог — строкой под площадкой. */
  readonly onEmpty: (empty: boolean) => void;
}

/** n03, hh.ru не подключён: «Подключить» открывает окно входа; из a11b оно открыто сразу. */
export function HhConnectAction({ onConnected, onEmpty }: HhConnectActionProps) {
  const [mode] = useState(() => hhImportMode(window.location.search));
  const [open, setOpen] = useState(mode !== null);

  async function connected(_resumes: readonly unknown[], parsed: ParsedResume, url: string) {
    await connectHhFromSession(parsed, url, mode);
    onConnected();
  }

  return (
    <>
      <div className="set-r cn-end">
        <button
          className="btn is-sm"
          type="button"
          aria-label="Подключить hh.ru"
          onClick={() => {
            onEmpty(false);
            setOpen(true);
          }}
        >
          Подключить
        </button>
      </div>
      <HhConnectModal
        isOpen={open}
        connectOnly={mode === 'connect_only'}
        onClose={() => setOpen(false)}
        onConnectSuccess={connected}
        onAuthenticatedEmpty={() => onEmpty(true)}
      />
    </>
  );
}
