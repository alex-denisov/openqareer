import { useEffect, useState } from 'react';
import type { CurrencyRates } from '../../../shared/currencyRates';
import { getCurrencyRates } from '../coach/coachApi';

/**
 * CPO 27.10: курсы ЦБ для порога фильтра «Зарплата». Без курсов фильтр
 * сравнивает только вакансии в той же валюте, как раньше.
 */
export function useCurrencyRates(): CurrencyRates | undefined {
  const [rates, setRates] = useState<CurrencyRates | undefined>();
  useEffect(() => {
    let alive = true;
    void getCurrencyRates()
      .then((next) => {
        if (alive && next) setRates(next);
      })
      // Без курсов фильтр работает по одной валюте; сервер пишет причину в свой журнал.
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  return rates;
}
