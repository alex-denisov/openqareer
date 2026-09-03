import { useCallback, useEffect, useState } from 'react';
import { chooseCareerStrategyRole, getCareerStrategy } from '../coach/coachApi';
import type { CareerStrategy } from '../../../shared/careerStrategy';

export interface CareerStrategyRead {
  readonly strategy: CareerStrategy | null;
  readonly loading: boolean;
  /** Маршрут не ответил — это не «стратегии нет», и путать их нельзя. */
  readonly failed: boolean;
  readonly saving: boolean;
  readonly error: string | null;
  choose(title: string, reason?: string): Promise<boolean>;
}

/**
 * Читает и меняет «Стратегию» кандидата (B180, срез 2).
 *
 * Отсутствие стратегии (`null`) и недоступный маршрут (`failed`) — разные
 * состояния: молчание сделало бы «ещё не выбирал» неотличимым от поломки.
 */
export function useCareerStrategy(provided?: CareerStrategyRead): CareerStrategyRead {
  const [strategy, setStrategy] = useState<CareerStrategy | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (provided) return;
    const controller = new AbortController();
    let active = true;
    getCareerStrategy(controller.signal)
      .then((read) => {
        if (active) setStrategy(read);
      })
      .catch(() => {
        if (active) setFailed(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [provided]);

  const choose = useCallback(async (title: string, reason?: string) => {
    setSaving(true);
    setError(null);
    try {
      setStrategy(await chooseCareerStrategyRole({ title, ...(reason ? { reason } : {}) }));
      return true;
    } catch (reasonError) {
      setError(
        reasonError instanceof Error
          ? reasonError.message
          : 'Роль не сохранилась. Попробуйте ещё раз.',
      );
      return false;
    } finally {
      setSaving(false);
    }
  }, []);

  return provided ?? { strategy, loading, failed, saving, error, choose };
}
