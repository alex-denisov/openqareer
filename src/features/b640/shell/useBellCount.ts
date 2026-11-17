import { useEffect, useState } from 'react';
import { listNotifications } from '../../notifications/notificationsApi';

/**
 * Число новых уведомлений у колокольчика: его считает оболочка, поэтому оно одно
 * на всех разделах. Перечитывается при переходе между адресами; сбой чтения
 * оставляет прежнее число.
 */
export function useBellCount(path: string): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    listNotifications({ limit: 1, signal: controller.signal }).then(
      (page) => {
        if (!controller.signal.aborted) setCount(page.unreadCount);
      },
      () => undefined,
    );
    return () => controller.abort();
  }, [path]);
  return count;
}
