import type { CountryFitEvaluation, MobilityScenarioId } from '../../../../shared/countryFit/types';
import { russianCityName } from '../../../../shared/salaryCountryCities';
import { calculateAnnualPayroll } from '../../../../shared/taxCalculators';

const MONTHS = 12;

function plural(count: number, [one, few, many]: readonly [string, string, string]): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

export const vacanciesLabel = (count: number): string =>
  `${count} ${plural(count, ['вакансия', 'вакансии', 'вакансий'])}`;

const countries = (count: number): string =>
  `${count} ${plural(count, ['страна', 'страны', 'стран'])}`;
const cities = (count: number): string =>
  `${count} ${plural(count, ['город', 'города', 'городов'])} России`;

/** Заголовок C06: страны, города России или оба вместе. */
export function placesTitle(countryCount: number, cityCount = 0): string {
  if (cityCount === 0) return `${countries(countryCount)}, куда можно уехать`;
  if (countryCount === 0) return `${cities(cityCount)}, куда можно уехать`;
  const total = countryCount + cityCount;
  return `${total} ${plural(total, ['место', 'места', 'мест'])}, куда можно уехать: ${countries(countryCount)} и ${cities(cityCount)}`;
}

const thousands = (amount: number): number => Math.round(amount / 1000);

/** Вилка города России в тысячах рублей. */
export const cityRange = (low: number, high: number): string =>
  `Вилка в городе: ${thousands(low)}–${thousands(high)} тыс. ₽`;

export const cityName = (slug: string): string => russianCityName(slug, slug);

const MODE: Readonly<Record<MobilityScenarioId, string>> = {
  domestic_market: 'работа по найму на месте',
  employer_sponsorship: 'релокация от работодателя',
  job_seeker_visa: 'виза для поиска работы',
  digital_nomad: 'удалённая работа из страны',
  simple_mobility: 'въезд без визы',
};

const FALLBACK: MobilityScenarioId = 'employer_sponsorship';

export interface WorkRight {
  readonly tag: 'ok' | 'part' | 'miss';
  readonly text: string;
  /** Путь работы в стране для подписи строки; `null` — путь не проверен. */
  readonly mode: string | null;
  /** Путь для расчёта трат; без проверенного пути — переезд с работодателем. */
  readonly scenarioId: MobilityScenarioId;
}

/** «Право работать» по правилам страны и анкете кандидата. */
export function workRight(fit: CountryFitEvaluation): WorkRight {
  const open = fit.scenarios.find((scenario) => scenario.status === 'available');
  const conditional = fit.scenarios.find((scenario) => scenario.status === 'barriers');
  if (open) {
    const mode = MODE[open.id];
    return { tag: 'ok', text: `Право работать: есть · ${mode}`, mode, scenarioId: open.id };
  }
  if (fit.status === 'legally_unavailable')
    return { tag: 'miss', text: 'Права работать нет', mode: null, scenarioId: FALLBACK };
  if (conditional) {
    const mode = MODE[conditional.id];
    return {
      tag: 'part',
      text: `Право работать: с условиями · ${mode}`,
      mode,
      scenarioId: conditional.id,
    };
  }
  return {
    tag: 'part',
    text: 'Право работать: неизвестно · виза не проверена',
    mode: null,
    scenarioId: FALLBACK,
  };
}

/** Город России: работа по найму на месте, визы нет. */
export const cityRight = (): WorkRight => ({
  tag: 'ok',
  text: 'Право работать: есть · без визы',
  mode: 'без визы',
  scenarioId: 'domestic_market',
});

export interface TaxLine {
  readonly label: string;
  readonly amount: number;
  readonly minus: boolean;
}

export interface PlaceTaxes {
  readonly currency: string;
  readonly lines: readonly TaxLine[];
  readonly net: number;
}

/** Месяц до налогов → налог, взносы и «на руки» по шкале страны. */
export function placeTaxes(countryCode: string, grossMonthly: number): PlaceTaxes | null {
  try {
    const payroll = calculateAnnualPayroll(countryCode, grossMonthly * MONTHS);
    const month = (value: number) => Math.round(value / MONTHS);
    const tax = payroll.incomeTax.amount + payroll.solidaritySurcharge;
    return {
      currency: payroll.currency,
      lines: [
        { label: 'Доход до налогов', amount: grossMonthly, minus: false },
        { label: 'Налог на доход', amount: month(tax), minus: true },
        ...payroll.employeeContributions.items.map((item) => ({
          label: item.name,
          amount: month(item.amount),
          minus: true,
        })),
      ],
      net: Math.round(payroll.netMonthlyIncome),
    };
  } catch {
    return null;
  }
}

export function formatMoney(amount: number, currency: string): string {
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}
