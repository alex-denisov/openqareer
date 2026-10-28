import { useEffect } from 'react';

const POLL_MS = 3_000;
const PENDING = new Set(['queued', 'running']);

/**
 * Поиск рекрутера идёт в фоне: пока он в очереди или в работе, карточка
 * компании перечитывается, иначе «Ищем рекрутера…» висит до перезагрузки (28.10).
 */
export function useRecruiterSearchPolling(status: string | undefined, reload: () => void): void {
  useEffect(() => {
    if (!status || !PENDING.has(status)) return undefined;
    // Интервал, а не таймер: «queued» → «queued» не меняет статус и не перезапустил бы эффект.
    const timer = window.setInterval(reload, POLL_MS);
    return () => window.clearInterval(timer);
  }, [status, reload]);
}
