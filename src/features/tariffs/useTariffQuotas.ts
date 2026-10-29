import { useEffect, useRef, useState } from 'react';
import { fetchTariffQuotas, type TariffQuotaSummary } from './tariffQuotaApi';

/**
 * Один запрос квот на все места, где они видны; смена `refreshKey` после
 * первого показа перечитывает остаток (ход завершён, тренировка начата).
 */
let shared: Promise<TariffQuotaSummary | null> | null = null;

function loadShared(force: boolean): Promise<TariffQuotaSummary | null> {
  if (!shared || force) {
    shared = fetchTariffQuotas().catch(() => null);
  }
  return shared;
}

export function useTariffQuotas(refreshKey?: unknown): TariffQuotaSummary | null {
  const [summary, setSummary] = useState<TariffQuotaSummary | null>(null);
  const mounted = useRef(false);
  useEffect(() => {
    let active = true;
    const force = mounted.current;
    mounted.current = true;
    void loadShared(force).then((next) => {
      if (active) setSummary(next);
    });
    return () => {
      active = false;
    };
  }, [refreshKey]);
  return summary;
}
