import { useEffect, useState } from 'react';
import { listB640Notifications } from '../today/b640NotificationsApi';

export interface BellState {
  readonly count: number;
  /** Есть важное непрочитанное (блок «Важно» в n01b): по макету n01 счётчик в цвете ошибки. */
  readonly critical: boolean;
}

/**
 * Число новых уведомлений у колокольчика — то же, что в списке n01b (повторы дня свёрнуты):
 * его считает оболочка, поэтому оно одно
 * на всех разделах. Перечитывается при переходе между адресами; сбой чтения
 * оставляет прежнее значение.
 */
export function useBellCount(path: string): BellState {
  const [count, setCount] = useState(0);
  const [critical, setCritical] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    const live = () => !controller.signal.aborted;
    listB640Notifications({ category: 'all', limit: 1, signal: controller.signal }).then(
      (page) => {
        if (!live()) return;
        setCount(page.unreadCount);
        setCritical(page.pinned.length > 0);
      },
      () => undefined,
    );
    return () => controller.abort();
  }, [path]);
  return { count, critical };
}
