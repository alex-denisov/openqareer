import { useEffect, useRef, useState } from 'react';
import type { MatchedPool } from '../../../vacancies/useMatchedPool';

/** Пауза перед единственным повтором чтения подборки. */
export const POOL_RETRY_DELAY_MS = 3_000;

/**
 * Подборка не прочиталась: раздел один раз повторяет чтение сам и только после
 * второго сбоя показывает ошибку с «Повторить». Пока идёт пауза — это ожидание.
 */
export function usePoolRetry(pool: Pick<MatchedPool, 'failed' | 'refresh'>): boolean {
  const used = useRef(false);
  const [waiting, setWaiting] = useState(false);
  const { failed, refresh } = pool;

  useEffect(() => {
    if (!failed || used.current || !refresh) return undefined;
    used.current = true;
    setWaiting(true);
    const timer = setTimeout(() => {
      setWaiting(false);
      refresh();
    }, POOL_RETRY_DELAY_MS);
    return () => clearTimeout(timer);
  }, [failed, refresh]);

  // Первый сбой ещё не показан: эффект повтора ставит паузу сразу после него.
  return waiting || (failed && !used.current && Boolean(refresh));
}
