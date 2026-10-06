/**
 * @file offerCompensation.ts
 * Расчёт совокупной компенсации и условий офферов (US-07.5, B394).
 * Итог рассчитывается исключительно детерминированной математической формулой (не моделью).
 * Все числа без верифицированного документа помечаются «со слов кандидата».
 */

export interface OfferTermsInput {
  readonly id?: string;
  readonly title?: string;
  readonly company?: string;
  readonly baseSalary?: number;
  readonly salaryPeriod?: 'month' | 'year';
  readonly bonus?: number;
  readonly equity?: string;
  readonly currency?: string;
  readonly location?: string;
  readonly format?: 'remote' | 'hybrid' | 'office' | string;
  readonly probationPeriodMonths?: number;
  readonly probationSalary?: number;
  readonly benefits?: readonly string[];
  readonly risks?: readonly string[];
  readonly startDate?: string;
  readonly sourceNote?: string;
}

export interface CompensationBreakdown {
  readonly annualBase: number;
  readonly annualBonus: number;
  readonly totalAnnualCompensation: number;
  readonly monthlyAverage: number;
  readonly currency: string;
  readonly sourceLabel: string;
  readonly hasProbationDiff: boolean;
}

export interface OfferComparisonEntry {
  readonly offer: OfferTermsInput;
  readonly breakdown: CompensationBreakdown;
}

export interface OfferComparisonResult {
  readonly offers: readonly OfferComparisonEntry[];
  readonly highestCompensationOfferId: string | null;
}

const DEFAULT_CURRENCY = 'RUB';
const DEFAULT_SOURCE_LABEL = 'со слов кандидата';
const MAX_COMPARISON_OFFERS = 4;

/**
 * Рассчитывает годовой оклад с учётом испытательного срока и периода выплаты.
 */
function calculateAnnualBase(offer: OfferTermsInput): { annualBase: number; hasProbationDiff: boolean } {
  const baseSalary = offer.baseSalary ?? 0;
  if (offer.salaryPeriod === 'year') {
    return { annualBase: baseSalary, hasProbationDiff: false };
  }

  const probationMonths = Math.min(Math.max(offer.probationPeriodMonths ?? 0, 0), 12);
  const probationSalary = offer.probationSalary;
  const hasProbationDiff = probationMonths > 0 && probationSalary !== undefined && probationSalary !== baseSalary;

  if (hasProbationDiff) {
    const regularMonths = 12 - probationMonths;
    const total = probationSalary * probationMonths + baseSalary * regularMonths;
    return { annualBase: total, hasProbationDiff: true };
  }

  return { annualBase: baseSalary * 12, hasProbationDiff: false };
}

/**
 * Расчёт совокупной компенсации по формуле:
 * Итоговая годовая компенсация = Базовый годовой доход + Бонусы.
 * Среднемесячный доход = Итоговая годовая компенсация / 12.
 */
export function calculateOfferCompensation(offer: OfferTermsInput): CompensationBreakdown {
  const { annualBase, hasProbationDiff } = calculateAnnualBase(offer);
  const annualBonus = offer.bonus ?? 0;
  const totalAnnualCompensation = annualBase + annualBonus;
  const monthlyAverage = Math.round(totalAnnualCompensation / 12);
  const currency = offer.currency?.trim() || DEFAULT_CURRENCY;
  const sourceLabel = offer.sourceNote?.trim() || DEFAULT_SOURCE_LABEL;

  return {
    annualBase,
    annualBonus,
    totalAnnualCompensation,
    monthlyAverage,
    currency,
    sourceLabel,
    hasProbationDiff,
  };
}

/**
 * Сравнение до четырёх офферов с упорядочиванием по совокупному доходу.
 */
export function compareOffers(offersList: readonly OfferTermsInput[]): OfferComparisonResult {
  const limitedList = offersList.slice(0, MAX_COMPARISON_OFFERS);
  const evaluated = limitedList.map((offer) => ({
    offer,
    breakdown: calculateOfferCompensation(offer),
  }));

  const sorted = [...evaluated].sort(
    (a, b) => b.breakdown.totalAnnualCompensation - a.breakdown.totalAnnualCompensation,
  );

  const highestCompensationOfferId = sorted.length > 0 ? (sorted[0].offer.id ?? null) : null;

  return {
    offers: sorted,
    highestCompensationOfferId,
  };
}
