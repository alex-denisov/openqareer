import { getCountryTaxData } from '../../../shared/taxData';
import type { CountryCode } from '../../../shared/taxData/types';
import { calculateAnnualPayroll } from '../../../shared/taxCalculators';

export const COUNTRY_CODES: readonly CountryCode[] = [
  'DE',
  'CY',
  'RS',
  'AE',
  'GE',
  'RU',
  'AM',
  'KZ',
  'TR',
  'UZ',
  'BY',
  'ME',
  'GB',
];
export const COUNTRY_FIT_STORAGE_KEY = 'openqareer:country-fit-scenario:v1';
export interface CountryFitScenario {
  readonly countryCode: CountryCode;
  readonly grossAnnualIncome: number;
  readonly currency: string;
}
export function parseCountryFitScenario(value: unknown): CountryFitScenario | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const item = value as Record<string, unknown>;
  if (!COUNTRY_CODES.includes(item.countryCode as CountryCode)) return undefined;
  const countryCode = item.countryCode as CountryCode;
  if (
    typeof item.grossAnnualIncome !== 'number' ||
    !Number.isFinite(item.grossAnnualIncome) ||
    item.grossAnnualIncome < 0 ||
    item.grossAnnualIncome > 1_000_000_000
  )
    return undefined;
  if (item.currency !== getCountryTaxData(countryCode).currency) return undefined;
  return { countryCode, grossAnnualIncome: item.grossAnnualIncome, currency: item.currency };
}
export function readCountryFitScenario(): CountryFitScenario | undefined {
  try {
    return parseCountryFitScenario(
      JSON.parse(sessionStorage.getItem(COUNTRY_FIT_STORAGE_KEY) ?? 'null'),
    );
  } catch {
    return undefined;
  }
}
export function saveCountryFitScenario(scenario: CountryFitScenario): boolean {
  const valid = parseCountryFitScenario(scenario);
  if (!valid) return false;
  try {
    sessionStorage.setItem(COUNTRY_FIT_STORAGE_KEY, JSON.stringify(valid));
    return true;
  } catch {
    return false;
  }
}
export function calculateCountryFitScenario(
  countryCode: CountryCode,
  gross: string,
  costs: readonly string[],
) {
  const income = Number(gross);
  if (!gross.trim() || !Number.isFinite(income) || income < 0 || income > 1_000_000_000)
    return { error: 'Введите годовой доход от 0 до 1 000 000 000.' } as const;
  const payroll = calculateAnnualPayroll(countryCode, income);
  const amounts = costs.map((value) => Number(value));
  const costsError = costs.some(
    (value, index) =>
      value.trim() &&
      (!Number.isFinite(amounts[index]) || amounts[index]! < 0 || amounts[index]! > 1_000_000_000),
  );
  return {
    payroll,
    costsError: costsError ? 'Введите расходы от 0 до 1 000 000 000.' : undefined,
    remainder:
      costs.every((value) => value.trim()) && !costsError
        ? payroll.netMonthlyIncome - amounts.reduce((sum, value) => sum + value, 0)
        : undefined,
  };
}

export function clearCountryFitScenario(): void {
  try {
    sessionStorage.removeItem(COUNTRY_FIT_STORAGE_KEY);
  } catch {
    /* Storage may be unavailable; no data can be read there either. */
  }
}

export function countryFitConstraint(scenario: CountryFitScenario): string {
  return `Сценарий Country Fit: ${getCountryTaxData(scenario.countryCode).name}, годовая зарплата до налогов ${scenario.grossAnnualIncome} ${scenario.currency}`;
}

/** Only a completed synchronous local write may consume the transferred input. */
export function saveWithCountryFitTransfer(save: () => void, constraints: string): void {
  save();
  const pending = readCountryFitScenario();
  if (pending && constraints.includes(countryFitConstraint(pending))) clearCountryFitScenario();
}
