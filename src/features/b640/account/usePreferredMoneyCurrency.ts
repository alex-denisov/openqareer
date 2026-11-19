import { useEffect, useState } from 'react';
import type { AppMoneyCurrency } from '../../../../shared/b640AppPreferences';
import { preferredMoneyCurrency } from './appPreferencesApi';

/** B593: валюта показа сумм из «Приложения»; `null`, пока не прочиталась или не выбрана. */
export function usePreferredMoneyCurrency(): AppMoneyCurrency | null {
  const [currency, setCurrency] = useState<AppMoneyCurrency | null>(null);
  useEffect(() => {
    let alive = true;
    void preferredMoneyCurrency().then((value) => {
      if (alive) setCurrency(value);
    });
    return () => {
      alive = false;
    };
  }, []);
  return currency;
}
