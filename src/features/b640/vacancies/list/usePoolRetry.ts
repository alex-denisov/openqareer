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

  const latest = useRef(refresh);
  latest.current = refresh;

  useEffect(() => {
    if (!failed || used.current || !latest.current) return undefined;
    setWaiting(true);
    // Повтор считается использованным, только когда пауза дошла до конца:
    // повторный запуск эффекта (StrictMode) ставит таймер заново.
    const timer = setTimeout(() => {
      used.current = true;
      setWaiting(false);
      latest.current?.();
    }, POOL_RETRY_DELAY_MS);
    return () => {
      clearTimeout(timer);
      setWaiting(false);
    };
  }, [failed]);

  // Первый сбой ещё не показан: эффект повтора ставит паузу сразу после него.
  return waiting || (failed && !used.current && Boolean(refresh));
}
