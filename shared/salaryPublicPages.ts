import { calculateAnnualPayroll } from './taxCalculators';
import { getCountryMobilityData } from './countryFit/mobilityData';
import type { TaxDataSource } from './taxData/types';
import type {
  SalaryCityRow,
  SalaryMarketSnapshot,
  SalaryMidpointGroup,
} from './salaryMarketSnapshot';
import {
  MIN_COUNTRY_CITY_VACANCIES,
  SALARY_COUNTRY_CITIES,
  type CountryCatalog,
  type CountryCityCount,
} from './salaryCountryCities';

/** B351 round 5 (27.10): every figure comes from the prepared snapshot or the tax calculator. */
const CURRENCY_SIGN: Readonly<Record<string, string>> = {
  RUR: '₽',
  RUB: '₽',
  KZT: '₸',
  USD: '$',
  EUR: '€',
  BYR: 'Br',
  BYN: 'Br',
  UZS: 'сум',
  KGS: 'сом',
  GEL: '₾',
  AED: 'AED',
  RSD: 'RSD',
};
const RUBLE = new Set(['RUR', 'RUB']);

export function formatMoney(amount: number, currency: string): string {
  const value = Math.round(amount).toLocaleString('ru-RU').replace(/\s/gu, ' ');
  return `${value} ${CURRENCY_SIGN[currency] ?? currency}`;
}
export function formatRange(group: SalaryMidpointGroup): string {
  const sign = CURRENCY_SIGN[group.currency] ?? group.currency;
  const low = Math.round(group.p25).toLocaleString('ru-RU').replace(/\s/gu, ' ');
  return `${low}–${formatMoney(group.p75, group.currency).replace(` ${sign}`, '')} ${sign}`;
}
export function formatDate(iso: string): string {
  const [year, month, day] = iso.slice(0, 10).split('-');
  return `${day}.${month}.${year}`;
}
function vacancyWord(count: number): string {
  const tens = count % 100;
  const units = count % 10;
  if (tens >= 11 && tens <= 14) return 'вакансий';
  if (units === 1) return 'вакансия';
  if (units >= 2 && units <= 4) return 'вакансии';
  return 'вакансий';
}
export function vacancies(count: number): string {
  return `${count.toLocaleString('ru-RU').replace(/\s/gu, ' ')} ${vacancyWord(count)}`;
}

/** Monthly take-home from a Russian monthly gross, by the product's own calculator. */
export function russianNetMonthly(grossMonthly: number): number {
  return calculateAnnualPayroll('RU', grossMonthly * 12).netMonthlyIncome;
}

export interface SalaryFaq {
  readonly question: string;
  readonly answer: string;
}
export interface SalaryCityView {
  readonly city: string;
  readonly placeSlug: string;
  readonly vacancyCount: number;
  readonly median: string;
  readonly range: string;
  readonly sampleSize: number;
  /** Bar position on the shared scale; absent for a currency outside the scale. */
  readonly bar?: { readonly left: number; readonly right: number; readonly mark: number };
}
export interface SalaryProfessionView {
  readonly role: string;
  readonly label: string;
  readonly labelGenitive: string;
  readonly labelDative: string;
  readonly date: string;
  readonly lead: SalaryCityView;
  readonly leadGroup: SalaryMidpointGroup;
  readonly basis: 'gross' | 'net' | 'unknown';
  readonly leadNet?: string;
  readonly answer: string;
  readonly sampleSize: number;
  readonly totalVacancies: number;
  readonly placesShown: number;
  readonly cities: readonly SalaryCityView[];
  readonly scaleMax?: string;
  readonly remote?: { readonly median: string; readonly sampleSize: number };
  readonly faqs: readonly SalaryFaq[];
}

const BASIS_TEXT = { gross: 'до налогов', net: 'на руки', unknown: 'налоги не указаны' } as const;

/** The Russian name in the genitive for «зарплата …»; the label itself when no form is known. */
function genitive(label: string): string {
  const lower = label.charAt(0).toLowerCase() + label.slice(1);
  if (/[^аеиоуыэюяйь]$/iu.test(lower) && !/\s/u.test(lower)) return `${lower}а`;
  return lower;
}

/** «Где бухгалтеру платят больше»; the label itself when no form is known. */
function dative(label: string): string {
  const lower = label.charAt(0).toLowerCase() + label.slice(1);
  if (/[^аеиоуыэюяйь]$/iu.test(lower) && !/\s/u.test(lower)) return `${lower}у`;
  return lower;
}

function scaleOf(rows: readonly SalaryCityRow[], currency: string): number {
  const top = Math.max(
    ...rows.filter((row) => row.salary.currency === currency).map((row) => row.salary.p75),
  );
  const step = 25_000;
  return Math.ceil((top * 1.25) / step) * step;
}

function cityView(row: SalaryCityRow, currency: string, scale: number): SalaryCityView {
  const group = row.salary;
  const position = (value: number) => Number(((value / scale) * 100).toFixed(1));
  return {
    city: row.city,
    placeSlug: row.placeSlug,
    vacancyCount: row.vacancyCount,
    median: formatMoney(group.p50, group.currency),
    range: formatRange(group),
    sampleSize: group.sampleSize,
    ...(group.currency === currency
      ? {
          bar: {
            left: position(group.p25),
            right: Number((100 - position(group.p75)).toFixed(1)),
            mark: position(group.p50),
          },
        }
      : {}),
  };
}

/** Null when no place reaches the publication minimum: the page then keeps its fallback. */
export function salaryProfessionView(snapshot: SalaryMarketSnapshot): SalaryProfessionView | null {
  const market = snapshot.cityMarket;
  const leadRow = market?.cities[0];
  if (!market || !leadRow) return null;
  const currency = leadRow.salary.currency;
  const scale = scaleOf(market.cities, currency);
  const cities = [...market.cities]
    .sort((a, b) => {
      const sameA = a.salary.currency === currency ? 0 : 1;
      const sameB = b.salary.currency === currency ? 0 : 1;
      return sameA - sameB || b.salary.p50 - a.salary.p50;
    })
    .map((row) => cityView(row, currency, scale));
  const lead = cityView(leadRow, currency, scale);
  const basis = leadRow.salary.taxBasis;
  const leadNet =
    basis === 'gross' && RUBLE.has(currency)
      ? formatMoney(russianNetMonthly(leadRow.salary.p50), currency)
      : undefined;
  const label = snapshot.roleLabel;
  const labelGenitive = genitive(label);
  const date = formatDate(snapshot.updatedAt);
  const others = cities.filter((city) => city.city !== lead.city && city.bar).slice(0, 2);
  const answer = [
    `Медиана вилок в вакансиях ${labelGenitive} в городе ${lead.city} — ${lead.median} в месяц ${BASIS_TEXT[basis]}`,
    leadNet ? `, на руки ${leadNet}` : '',
    ` (${vacancies(lead.sampleSize)} с вилкой, открытый каталог openqareer, ${date}).`,
    others.length ? ` ${others.map((city) => `${city.city} — ${city.median}`).join(', ')}.` : '',
    ` Половина вакансий укладывается в вилку ${lead.range}.`,
  ].join('');
  const remoteRow = market.remote;
  const remote =
    remoteRow && remoteRow.salary.currency !== currency
      ? {
          median: `${formatMoney(remoteRow.salary.p50, remoteRow.salary.currency)} в месяц`,
          sampleSize: remoteRow.salary.sampleSize,
        }
      : undefined;
  const faqs: SalaryFaq[] = [
    {
      question: `Сколько получает ${label.toLowerCase()} в городе ${lead.city}?`,
      answer: `Медиана вилок в вакансиях — ${lead.median} в месяц ${BASIS_TEXT[basis]}, половина вакансий платит ${lead.range}. Выборка — ${vacancies(lead.sampleSize)} с вилкой на ${date}.`,
    },
    ...(leadNet
      ? [
          {
            question: `Сколько ${label.toLowerCase()} получает на руки?`,
            answer: `С медианы ${lead.median} до налогов на руки остаётся ${leadNet} в месяц по расчёту калькулятора openqareer по ставкам НДФЛ 2026 года.`,
          },
        ]
      : []),
    {
      question: 'Какую зарплату просить на собеседовании?',
      answer: `Одно число у верхней границы половины вакансий своего города — для города ${lead.city} это около ${formatMoney(leadRow.salary.p75, currency)}, если опыт и задачи соответствуют вакансии.`,
    },
    {
      question: 'Как считаются эти цифры?',
      answer: `Берём вакансии с обеими границами «от — до» и помесячной вилкой, считаем середину. Город, где меньше ${market.minSample} таких вакансий, не показываем. Пересчёт — каждый день.`,
    },
  ];
  return {
    role: snapshot.role,
    label,
    labelGenitive,
    labelDative: dative(label),
    date,
    lead,
    leadGroup: leadRow.salary,
    basis,
    ...(leadNet ? { leadNet } : {}),
    answer,
    sampleSize: market.publishedSample,
    totalVacancies: snapshot.sampleSize,
    placesShown: cities.length,
    cities,
    ...(cities.some((city) => !city.bar) || cities.length
      ? { scaleMax: formatMoney(scale, currency) }
      : {}),
    ...(remote ? { remote } : {}),
    faqs,
  };
}

export const SALARY_BASIS_TEXT = BASIS_TEXT;

/** Countries the tax calculator covers, with the reference amounts of mockup 06b. */
export const SALARY_COUNTRIES = {
  cyprus: {
    code: 'CY',
    name: 'Кипр',
    in: 'на Кипре',
    to: 'на Кипр',
    currency: 'EUR',
    reference: 5000,
    steps: [2000, 3000, 4000, 5000, 6000, 8000, 10_000],
  },
  germany: {
    code: 'DE',
    name: 'Германия',
    in: 'в Германии',
    to: 'в Германию',
    currency: 'EUR',
    reference: 5000,
    steps: [2000, 3000, 4000, 5000, 6000, 8000, 10_000],
  },
  uae: {
    code: 'AE',
    name: 'ОАЭ',
    in: 'в ОАЭ',
    to: 'в ОАЭ',
    currency: 'AED',
    reference: 20_000,
    steps: [10_000, 15_000, 20_000, 30_000, 50_000],
  },
  georgia: {
    code: 'GE',
    name: 'Грузия',
    in: 'в Грузии',
    to: 'в Грузию',
    currency: 'GEL',
    reference: 5000,
    steps: [2000, 3000, 5000, 8000, 12_000],
  },
  serbia: {
    code: 'RS',
    name: 'Сербия',
    in: 'в Сербии',
    to: 'в Сербию',
    currency: 'RSD',
    reference: 500_000,
    steps: [150_000, 250_000, 350_000, 500_000, 700_000, 1_000_000],
  },
} as const;
export type SalaryCountrySlug = keyof typeof SALARY_COUNTRIES;
export function isSalaryCountrySlug(value: string): value is SalaryCountrySlug {
  return Object.hasOwn(SALARY_COUNTRIES, value);
}

export interface NetRow {
  readonly gross: string;
  readonly deductions: string;
  readonly net: string;
  readonly share: string;
  readonly note?: string;
}
export interface RelocationThreshold {
  readonly label: string;
  readonly amount: string;
  readonly sum: string;
  readonly per: string;
  readonly explanation: string;
  readonly source: TaxDataSource;
}
export interface SalaryCountryView {
  readonly slug: SalaryCountrySlug;
  readonly name: string;
  readonly inName: string;
  readonly toName: string;
  readonly code: string;
  readonly cities: readonly (CountryCityCount & { readonly genitive: string })[];
  readonly catalogDate?: string;
  readonly taxYear: number;
  readonly assumptions: string;
  readonly rows: readonly NetRow[];
  readonly reference: NetRow;
  readonly answer: string;
  readonly thresholds: readonly RelocationThreshold[];
  readonly others: readonly (NetRow & {
    readonly slug: SalaryCountrySlug;
    readonly name: string;
  })[];
  readonly faqs: readonly SalaryFaq[];
}

function percent(value: number): string {
  return `${value.toLocaleString('ru-RU', { maximumFractionDigits: 1 })} %`;
}
function netRow(code: string, currency: string, monthly: number, note?: string): NetRow {
  const result = calculateAnnualPayroll(code, monthly * 12);
  const net = result.netMonthlyIncome;
  return {
    gross: formatMoney(monthly, currency),
    deductions: formatMoney(monthly - net, currency),
    net: formatMoney(net, currency),
    share: percent((net / monthly) * 100),
    ...(note ? { note } : {}),
  };
}

/** Salary thresholds of the verified relocation paths, with their official source. */
function relocationThresholds(code: string): RelocationThreshold[] {
  const seen = new Set<string>();
  const out: RelocationThreshold[] = [];
  for (const scenario of getCountryMobilityData(code).scenarios) {
    if (scenario.dataStatus !== 'verified') continue;
    for (const path of scenario.paths) {
      for (const requirement of path.requirements) {
        if (
          requirement.kind !== 'minimum_annual_salary' &&
          requirement.kind !== 'minimum_monthly_funds'
        )
          continue;
        const key = `${requirement.kind}:${requirement.amount}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
          label: path.label,
          sum: formatMoney(requirement.amount, requirement.currency),
          per: requirement.kind === 'minimum_annual_salary' ? 'в год' : 'в месяц',
          amount: `${formatMoney(requirement.amount, requirement.currency)} ${requirement.kind === 'minimum_annual_salary' ? 'в год' : 'в месяц'}`,
          explanation: requirement.explanation,
          source: requirement.source,
        });
      }
    }
  }
  return out;
}

function countryCities(code: string, catalog?: CountryCatalog) {
  const genitives = SALARY_COUNTRY_CITIES[code] ?? {};
  return (catalog?.cities ?? [])
    .filter((city) => genitives[city.slug] && city.count >= MIN_COUNTRY_CITY_VACANCIES)
    .map((city) => ({ ...city, genitive: genitives[city.slug]! }))
    .sort((a, b) => b.count - a.count);
}

export function salaryCountryView(
  slug: SalaryCountrySlug,
  catalog?: CountryCatalog,
): SalaryCountryView {
  const country = SALARY_COUNTRIES[slug];
  const sample = calculateAnnualPayroll(country.code, country.reference * 12);
  const thresholds = relocationThresholds(country.code);
  const blueCard = thresholds.find((item) => item.label.includes('общий порог'));
  const blueCardMonthly =
    country.code === 'DE' && blueCard
      ? Number.parseFloat(blueCard.amount.replace(/\D/gu, '')) / 12
      : undefined;
  const amounts = [...country.steps, ...(blueCardMonthly ? [blueCardMonthly] : [])].sort(
    (a, b) => a - b,
  );
  const rows = amounts.map((amount) =>
    netRow(
      country.code,
      country.currency,
      amount,
      amount === blueCardMonthly ? 'порог Blue Card' : undefined,
    ),
  );
  const reference = netRow(country.code, country.currency, country.reference);
  const shares = rows.map((row) => Number.parseFloat(row.share.replace(',', '.')));
  const answer = `С ${reference.gross} до налогов ${country.in} остаётся ${reference.net} на руки в месяц (расчёт openqareer по ставкам ${sample.taxYear} года). При зарплате от ${rows[0]!.gross} до ${rows[rows.length - 1]!.gross} в месяц на руки остаётся ${Math.round(Math.min(...shares))}–${Math.round(Math.max(...shares))} %.`;
  const others = (Object.keys(SALARY_COUNTRIES) as SalaryCountrySlug[]).map((other) => {
    const item = SALARY_COUNTRIES[other];
    return { slug: other, name: item.name, ...netRow(item.code, item.currency, item.reference) };
  });
  const faqs: SalaryFaq[] = [
    {
      question: `Сколько остаётся на руки с ${reference.gross} ${country.in}?`,
      answer: `${reference.net} в месяц, налоги и взносы — ${reference.deductions}. Допущения расчёта: ${sample.assumptionSummary}`,
    },
    ...(blueCard
      ? [
          {
            question: `Какая зарплата нужна для Blue Card в ${sample.taxYear} году?`,
            answer: `Общий порог — ${blueCard.amount} до налогов. ${thresholds
              .filter((item) => item !== blueCard && item.amount.endsWith('в год'))
              .map((item) => `${item.label} — ${item.amount}.`)
              .join(' ')}`.trim(),
          },
        ]
      : []),
  ];
  return {
    slug,
    name: country.name,
    inName: country.in,
    toName: country.to,
    code: country.code,
    cities: countryCities(country.code, catalog),
    ...(catalog ? { catalogDate: formatDate(catalog.readAt) } : {}),
    taxYear: sample.taxYear,
    assumptions: sample.assumptionSummary,
    rows,
    reference,
    answer,
    thresholds,
    others,
    faqs,
  };
}

export function faqStructuredData(faqs: readonly SalaryFaq[]): Record<string, unknown> {
  return {
    '@type': 'FAQPage',
    mainEntity: faqs.map((faq) => ({
      '@type': 'Question',
      name: faq.question,
      acceptedAnswer: { '@type': 'Answer', text: faq.answer },
    })),
  };
}
