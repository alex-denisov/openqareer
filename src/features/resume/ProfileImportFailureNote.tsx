import { ArrowsClockwise, WarningCircle } from '@phosphor-icons/react';
import { useLinkedInImportFailure } from '../connections/linkedinImportProgress';

/**
 * Макет 2 «Ошибка импорта». Обход LinkedIn останавливается на первом
 * неотвеченном разделе и не перечитывает чаще раза в 12 часов (B266), поэтому
 * повтор — обычное чтение заново, а не отдельный раздел «прямо сейчас».
 */
export function ProfileImportFailureNote({
  onReimport,
  variant,
}: {
  readonly onReimport?: () => void;
  readonly variant: 'desktop' | 'mobile';
}) {
  const failure = useLinkedInImportFailure();
  if (!failure) return null;
  return (
    <div className={`profile-import-failure is-${variant}`}>
      <p role="alert">
        <WarningCircle size={16} aria-hidden="true" />
        <span>LinkedIn: раздел «{failure.label}» не прочитан, сайт не ответил.</span>
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
