import { useEffect, useState } from 'react';
import { fetchTariffQuotas, type TariffQuotaSummary } from './tariffQuotaApi';

/**
 * Остаток читается заново при каждом показе и при смене `refreshKey` (ход
 * завершён, тренировка начата); одновременные показы делят один запрос.
 */
let inFlight: Promise<TariffQuotaSummary | null> | null = null;

function loadQuotas(): Promise<TariffQuotaSummary | null> {
  inFlight ??= fetchTariffQuotas()
    .catch(() => null)
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

export function useTariffQuotas(refreshKey?: unknown): TariffQuotaSummary | null {
  const [summary, setSummary] = useState<TariffQuotaSummary | null>(null);
  useEffect(() => {
    let active = true;
    void loadQuotas().then((next) => {
      if (active) setSummary(next);
    });
    return () => {
      active = false;
    };
  }, [refreshKey]);
  return summary;
}
