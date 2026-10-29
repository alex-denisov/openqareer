import { ArrowsClockwise, WarningCircle } from '@phosphor-icons/react';
import type { ImportWalk } from '../coach/coachApi';
import {
  linkedinStageLabel,
  useLinkedInImportFailure,
} from '../connections/linkedinImportProgress';
import { isWalkCurrent } from './profileProvenance';

/**
 * Макет 2 «Ошибка импорта». Обход LinkedIn останавливается на первом
 * неотвеченном разделе и не перечитывает чаще раза в 12 часов (B266), поэтому
 * повтор — обычное чтение заново, а не отдельный раздел «прямо сейчас».
 */
export function ProfileImportFailureNote({
  onReimport,
  variant,
  storedWalk,
}: {
  readonly onReimport?: () => void;
  readonly variant: 'desktop' | 'mobile';
  /** B541: the walk the server kept, so the note survives a reload. */
  readonly storedWalk?: ImportWalk;
}) {
  const failed = (isWalkCurrent(storedWalk) ? storedWalk : undefined)?.sections.find(
    (section) => section.status === 'failed',
  );
  const failure =
    useLinkedInImportFailure() ?? (failed ? { label: linkedinStageLabel(failed.key) } : null);
  if (!failure) return null;
  return (
    <div className={`profile-import-failure is-${variant}`}>
      <p role="alert">
        <WarningCircle size={16} aria-hidden="true" />
        <span>
          LinkedIn: раздел «{failure.label}» не прочитан, сайт не ответил. Остальные разделы
          сохранены.
        </span>
      </p>
      {onReimport ? (
        <button type="button" className="career-quiet-button" onClick={onReimport}>
          <ArrowsClockwise size={16} aria-hidden="true" />
          Повторить чтение LinkedIn
        </button>
      ) : null}
    </div>
  );
}
