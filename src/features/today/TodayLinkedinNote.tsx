import { Info, LinkedinLogo } from '@phosphor-icons/react';

type Platform = 'linkedin' | 'hh';

const LINKEDIN_LATER = 'Постов и контактов LinkedIn пока нет: доступно после подключения.';

/** Текст макета 1; «по hh.ru» — только если hh.ru и правда подключён. */
export function todayLinkedinNoteCopy(connected: readonly Platform[]): string | null {
  if (connected.includes('linkedin')) return null;
  return connected.includes('hh') ? `Очередь собрана по hh.ru. ${LINKEDIN_LATER}` : LINKEDIN_LATER;
}

/**
 * Макет 1 «Частично: LinkedIn не подключён». Площадки приходят в ответе
 * `/today`: каталог подключений на старте не читается (verify-built-shell).
 * Старый сервер без поля — заметки нет, а не ложное «не подключён».
 */
export function TodayLinkedinNote({
  queueSize,
  connectedSources,
  onOpenConnections,
}: {
  readonly queueSize: number;
  readonly connectedSources?: readonly Platform[];
  readonly onOpenConnections?: () => void;
}) {
  const copy = connectedSources && queueSize > 0 ? todayLinkedinNoteCopy(connectedSources) : null;
  if (!copy) return null;
  return (
    <div className="today-linkedin-note">
      <p>
        <Info size={16} aria-hidden="true" />
        <span>{copy}</span>
      </p>
      {onOpenConnections ? (
        <button type="button" className="career-quiet-button" onClick={onOpenConnections}>
          <LinkedinLogo size={16} aria-hidden="true" />
          Подключить LinkedIn
        </button>
      ) : null}
    </div>
  );
}
