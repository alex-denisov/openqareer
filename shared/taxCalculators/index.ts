import { getCountryTaxData } from '../taxData';
import {
  calculateGermanIncomeTax,
  germanSolidaritySurcharge,
  germanWageTaxBase,
} from './germanyPayroll';
import type { CountryCode, SourcedMonthlyCost, TaxBand, TaxDataSource } from '../taxData/types';

export interface IncomeTaxResult {
  readonly countryCode: CountryCode;
  readonly currency: string;
  readonly taxYear: number;
  readonly taxableIncome: number;
  readonly amount: number;
  readonly source: TaxDataSource;
}

export interface PayrollOptions {
  readonly taxableIncome?: number;
  readonly germanyChildless?: boolean;
  readonly georgiaPensionParticipant?: boolean;
  readonly uaeNational?: boolean;
}

export interface PayrollResult {
  readonly countryCode: CountryCode;
  readonly currency: string;
  readonly taxYear: number;
  readonly grossAnnualIncome: number;
  readonly taxableAnnualIncome: number;
  readonly incomeTax: IncomeTaxResult;
  /** Germany's Solidaritätszuschlag on the income tax; 0 elsewhere. */
  readonly solidaritySurcharge: number;
  readonly employeeContributions: {
    readonly items: readonly {
      readonly name: string;
      readonly amount: number;
      readonly source: TaxDataSource;
    }[];
    readonly total: number;
  };
  readonly netAnnualIncome: number;
  readonly netMonthlyIncome: number;
  readonly assumptions: readonly string[];
  /** The calculation's assumptions in one line for «Откуда цифры». */
  readonly assumptionSummary: string;
}

export type DisposableIncomeResult =
  | {
      readonly status: 'unavailable';
      readonly amount: null;
      readonly missing: readonly ('rent' | 'insurance')[];
    }
  | {
      readonly status: 'available';
      readonly amount: number;
      readonly currency: string;
      readonly monthlyNetIncome: number;
      readonly rent: SourcedMonthlyCost;
      readonly insurance: SourcedMonthlyCost;
    };

const roundToCents = (amount: number): number => Number(amount.toFixed(2));

function validateAmount(amount: number, label = 'Доход'): void {
  if (!Number.isFinite(amount)) throw new Error(`${label} должен быть конечным числом`);
  if (amount < 0) throw new Error(`${label} не может быть отрицательным`);
}

function calculateBracketTax(income: number, bands: readonly TaxBand[]): number {
  let remaining = income;
  let previousLimit = 0;
  let tax = 0;

  for (const band of bands) {
    const taxableWidth =
      band.upTo === null ? remaining : Math.min(remaining, band.upTo - previousLimit);
    if (taxableWidth > 0) tax += taxableWidth * band.rate;
    remaining -= taxableWidth;
    if (remaining <= 0 || band.upTo === null) break;
    previousLimit = band.upTo;
  }

  return roundToCents(tax);
}

function calculateTaxAmount(countryCode: CountryCode, taxableIncome: number): number {
  const rule = getCountryTaxData(countryCode).incomeTax;
  switch (rule.kind) {
    case 'germany-2026':
      return calculateGermanIncomeTax(taxableIncome);
    case 'brackets':
      return calculateBracketTax(taxableIncome, rule.bands);
    case 'flat-after-monthly-allowance':
      return roundToCents(Math.max(0, taxableIncome - rule.monthlyAllowance * 12) * rule.rate);
    case 'flat':
      return roundToCents(taxableIncome * rule.rate);
    case 'none':
      return 0;
  }
}

export function calculateAnnualIncomeTax(
  countryCode: string,
  taxableIncome: number,
): IncomeTaxResult {
  validateAmount(taxableIncome);
  const data = getCountryTaxData(countryCode);
  return {
    countryCode: data.code,
    currency: data.currency,
    taxYear: data.taxYear,
    taxableIncome,
    amount: calculateTaxAmount(data.code, taxableIncome),
    source: data.incomeTax.source,
  };
}

function contributionBase(
  grossAnnualIncome: number,
  rule: {
    readonly annualCap?: number;
    readonly monthlyCap?: number;
    readonly monthlyFloor?: number;
  },
): number {
  if (rule.monthlyCap !== undefined || rule.monthlyFloor !== undefined) {
    const monthlyIncome = grossAnnualIncome / 12;
    const floorApplied = Math.max(monthlyIncome, rule.monthlyFloor ?? 0);
    return Math.min(floorApplied, rule.monthlyCap ?? Number.POSITIVE_INFINITY) * 12;
  }
  return Math.min(grossAnnualIncome, rule.annualCap ?? Number.POSITIVE_INFINITY);
}

/** Without a family in the scenario Germany is calculated for an employee without children. */
const germanyChildless = (options: PayrollOptions): boolean => options.germanyChildless !== false;

/** Cyprus deducts social insurance (not GeSY) from the taxable base, at most a fifth of income. */
function cyprusTaxBase(
  grossAnnualIncome: number,
  contributions: ReturnType<typeof collectEmployeeContributions>,
): number {
  const socialInsurance = contributions.items
    .filter(({ name }) => name === 'Социальное страхование')
    .reduce((total, item) => total + item.amount, 0);
  return roundToCents(grossAnnualIncome - Math.min(socialInsurance, grossAnnualIncome / 5));
}

function defaultTaxableIncome(
  countryCode: CountryCode,
  grossAnnualIncome: number,
  options: PayrollOptions,
  contributions: ReturnType<typeof collectEmployeeContributions>,
): number {
  if (countryCode === 'DE') return germanWageTaxBase(grossAnnualIncome, germanyChildless(options));
  if (countryCode === 'CY') return cyprusTaxBase(grossAnnualIncome, contributions);
  return grossAnnualIncome;
}

function isContributionApplicable(
  eligibility: 'germany-childless' | 'georgia-pension-member' | undefined,
  options: PayrollOptions,
): boolean {
  if (eligibility === 'germany-childless') return germanyChildless(options);
  if (eligibility === 'georgia-pension-member') return options.georgiaPensionParticipant === true;
  return true;
}

function collectEmployeeContributions(
  countryCode: CountryCode,
  grossAnnualIncome: number,
  options: PayrollOptions,
) {
  const data = getCountryTaxData(countryCode);
  const items = data.employeeContributions
    .filter(({ eligibility }) => isContributionApplicable(eligibility, options))
    .map(({ name, rate, source, ...limits }) => ({
      name,
      amount: roundToCents(contributionBase(grossAnnualIncome, limits) * rate),
      source,
    }));
  return { items, total: roundToCents(items.reduce((total, item) => total + item.amount, 0)) };
}

function assumptionsFor(countryCode: CountryCode, options: PayrollOptions): string[] {
  const common = [
    'Расчёт относится к налоговому году 2026 и использует годовую зарплату, равномерно выплачиваемую 12 месяцев.',
  ];
  switch (countryCode) {
    case 'DE':
      return [
        ...common,
        'Налог на зарплату считается как у работодателя по программе BMF 2026: I налоговый класс, база за вычетом паушальных расходов и обязательных взносов, плюс солидарный сбор.',
        'Используется государственная медицинская страховка вне Саксонии и средняя добавочная ставка 2,9%; индивидуальная ставка кассы может отличаться.',
        'Церковный налог не начисляется.',
        germanyChildless(options)
          ? 'Включена надбавка по страхованию ухода для бездетных работников.'
          : 'Надбавка для бездетных не включена: в сценарии есть дети.',
      ];
    case 'CY':
      return [
        ...common,
        'Взносы в социальное страхование вычитаются из налоговой базы (не больше пятой части дохода); взнос GeSY не вычитается.',
        'Семейные, жилищные и другие индивидуальные вычеты не рассчитываются.',
      ];
    case 'RS':
      return [
        ...common,
        'Используется сценарий штатного работника; месячные минимальная и максимальная базы применяются к каждому из 12 месяцев.',
        'Годовой налог на высокий доход по итогам года не рассчитывается.',
      ];
    case 'GE':
      return [
        ...common,
        options.georgiaPensionParticipant
          ? 'Включён взнос работника в накопительную пенсионную схему; применимость участия подтверждает пользователь.'
          : 'Накопительный пенсионный взнос не включён, так как участие зависит от статуса работника.',
      ];
    case 'AE':
      return [
        ...common,
        'Используется сценарий иностранного работника; расчёт пенсионных взносов граждан ОАЭ не входит в модуль.',
      ];
    case 'RU':
      return [
        ...common,
        'Используется налоговый резидент РФ и основная налоговая база; вычеты и особые категории дохода не учитываются.',
      ];
  }
}

function assumptionSummaryFor(countryCode: CountryCode, options: PayrollOptions): string {
  switch (countryCode) {
    case 'DE':
      return `I налоговый класс, без церковного налога, государственная медстраховка со средней надбавкой 2,9%, ${germanyChildless(options) ? 'без детей' : 'есть дети'}`;
    case 'CY':
      return 'Соцстрахование вычтено из базы, GeSY не вычитается, без индивидуальных вычетов';
    case 'RS':
      return 'Штатный работник, без годового налога на высокий доход';
    case 'GE':
      return options.georgiaPensionParticipant
        ? 'С накопительной пенсией 2%'
        : 'Без накопительной пенсии';
    case 'AE':
      return 'Иностранный работник: налога на доход и взносов нет';
    case 'RU':
      return 'Налоговый резидент РФ, без вычетов';
  }
}

export function calculateAnnualPayroll(
  countryCode: string,
  grossAnnualIncome: number,
  options: PayrollOptions = {},
): PayrollResult {
  validateAmount(grossAnnualIncome);
  if (options.taxableIncome !== undefined) validateAmount(options.taxableIncome);
  const data = getCountryTaxData(countryCode);
  if (data.code === 'AE' && options.uaeNational === true) {
    throw new Error('Расчёт пенсионных взносов граждан ОАЭ не поддерживается');
  }

  const employeeContributions = collectEmployeeContributions(data.code, grossAnnualIncome, options);
  const taxableAnnualIncome =
    options.taxableIncome ??
    defaultTaxableIncome(data.code, grossAnnualIncome, options, employeeContributions);
  const incomeTax = calculateAnnualIncomeTax(data.code, taxableAnnualIncome);
  const solidaritySurcharge = data.code === 'DE' ? germanSolidaritySurcharge(incomeTax.amount) : 0;
  const netAnnualIncome = roundToCents(
    Math.max(
      0,
      grossAnnualIncome - incomeTax.amount - solidaritySurcharge - employeeContributions.total,
    ),
  );

  return {
    countryCode: data.code,
    currency: data.currency,
    taxYear: data.taxYear,
    grossAnnualIncome,
    taxableAnnualIncome,
    incomeTax,
    solidaritySurcharge,
    employeeContributions,
    netAnnualIncome,
    netMonthlyIncome: roundToCents(netAnnualIncome / 12),
    assumptions: assumptionsFor(data.code, options),
    assumptionSummary: assumptionSummaryFor(data.code, options),
  };
}

function validateMonthlyCost(cost: SourcedMonthlyCost, currency: string): void {
  validateAmount(cost.amount, 'Расход');
  if (cost.currency !== currency)
    throw new Error('Валюта расходов должна совпадать с валютой страны');
  if (
    !Number.isInteger(cost.source.dataYear) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(cost.source.retrievedAt)
  ) {
    throw new Error('Для расхода нужны год данных и дата получения');
  }
  const url = new URL(cost.source.url);
  if (url.protocol !== 'https:') throw new Error('Источник расхода должен использовать HTTPS');
}

export function calculateDisposableIncome(
  payroll: PayrollResult,
  rent: SourcedMonthlyCost | null,
  insurance: SourcedMonthlyCost | null,
): DisposableIncomeResult {
  const missing = [rent === null ? 'rent' : null, insurance === null ? 'insurance' : null].filter(
    (item): item is 'rent' | 'insurance' => item !== null,
  );
  if (rent === null || insurance === null) return { status: 'unavailable', amount: null, missing };
  validateMonthlyCost(rent, payroll.currency);
  validateMonthlyCost(insurance, payroll.currency);
  return {
    status: 'available',
    amount: roundToCents(payroll.netMonthlyIncome - rent.amount - insurance.amount),
    currency: payroll.currency,
    monthlyNetIncome: payroll.netMonthlyIncome,
    rent,
    insurance,
  };
}
