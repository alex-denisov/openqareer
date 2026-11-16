import type { CurrencyRates } from '../../../../../shared/currencyRates';

/** Текст ⓘ у «Денег»: курс ЦБ с датой; без курса ⓘ нет. */
export function ratesTipText(rates: CurrencyRates | undefined): string | null {
  if (!rates) return null;
  const [, month, day] = rates.date.split('-');
  const pairs = (['USD', 'EUR'] as const)
    .filter((code) => rates.rubPerUnit[code] !== undefined)
    .map((code) => {
      const rate = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(rates.rubPerUnit[code]);
      return `1 ${code === 'USD' ? '$' : '€'} = ${rate} ₽`;
    });
  if (pairs.length === 0) return null;
  return `Пересчёт по курсу ЦБ на ${day}.${month}: ${pairs.join(', ')}. Нет курса — исходная сумма без «≈».`;
}
