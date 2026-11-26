/** B803: разбор открытых данных (CC BY): ILOSTAT — заработок по ISCO и стране, WDI — доход на душу. */
import { z } from 'zod';

const INDICATOR = 'EAR_EMTA_SEX_OCU_CUR_NB_A';
export const ILOSTAT_URL =
  `https://rplumber.ilo.org/data/indicator/?id=${INDICATOR}` +
  '&sex=SEX_T&classif2=CUR_TYPE_USD&timefrom=2018&type=code&format=.csv';
export const WDI_URL =
  'https://api.worldbank.org/v2/country/all/indicator/NY.GNP.PCAP.CD?format=json&date=2018:2030&per_page=20000';

/** Серверная запись источника: лицензия CC BY 4.0 требует её хранить; кандидату не показываем. */
export const OPEN_STATISTICS_SOURCES = [
  {
    table: 'occupation_earnings',
    name: 'ILOSTAT, International Labour Organization',
    license: 'CC BY 4.0',
    attribution: `Source: International Labour Organization, ILOSTAT, ${INDICATOR}; filtered by openqareer`,
    url: ILOSTAT_URL,
  },
  {
    table: 'country_income',
    name: 'World Development Indicators, World Bank',
    license: 'CC BY 4.0',
    attribution:
      'Source: World Bank, World Development Indicators, NY.GNP.PCAP.CD; filtered by openqareer',
    url: WDI_URL,
  },
] as const;

/** Среднемесячный заработок в долларах США по крупной группе ISCO-08. */
export interface OccupationEarning {
  readonly iso3: string;
  readonly isco: string;
  readonly year: number;
  readonly monthlyUsd: number;
}

/** Валовой национальный доход на душу (метод Атласа), долларов США в год. */
export interface CountryIncome {
  readonly iso2: string;
  readonly iso3: string;
  readonly year: number;
  readonly perCapitaUsd: number;
}

function cells(line: string): string[] {
  return [...line.matchAll(/"([^"]*)"|([^,]+)|(?<=,)(?=,|$)/gu)].map(
    (match) => match[1] ?? match[2] ?? '',
  );
}

const newest = <T extends { readonly year: number }>(
  rows: readonly T[],
  key: (row: T) => string,
): T[] => {
  const latest = new Map<string, T>();
  for (const row of rows) {
    if ((latest.get(key(row))?.year ?? 0) < row.year) latest.set(key(row), row);
  }
  return [...latest.values()];
};

function earningOf(record: Readonly<Record<string, string>>): OccupationEarning | undefined {
  const isco = /^OCU_ISCO08_(TOTAL|[1-9])$/u.exec(record.classif1 ?? '')?.[1];
  const monthlyUsd = Number(record.obs_value);
  const year = Number(record.time);
  const valid =
    record.sex === 'SEX_T' &&
    record.classif2 === 'CUR_TYPE_USD' &&
    /^[A-Z]{3}$/u.test(record.ref_area ?? '') &&
    // «U» — сам источник считает значение ненадёжным.
    record.obs_status !== 'U' &&
    Number.isInteger(year) &&
    monthlyUsd > 0;
  return valid && isco ? { iso3: record.ref_area!, isco, year, monthlyUsd } : undefined;
}

export function parseIlostat(csv: string): OccupationEarning[] {
  const [header = '', ...lines] = csv.replace(/^\uFEFF/u, '').split(/\r?\n/u);
  const names = cells(header);
  const rows = lines.flatMap((line) => {
    const values = cells(line);
    const row = earningOf(
      Object.fromEntries(names.map((key, index) => [key, values[index] ?? ''])),
    );
    return row ? [row] : [];
  });
  return newest(rows, (row) => `${row.iso3}|${row.isco}`);
}

const wdiSchema = z.tuple([
  z.object({ pages: z.number() }),
  z.array(
    z.object({
      country: z.object({ id: z.string() }),
      countryiso3code: z.string(),
      date: z.string(),
      value: z.number().nullable(),
    }),
  ),
]);

/** Строки-агрегаты («World», «Arab World») остаются: стран с таким кодом у вакансий нет. */
export function parseWdi(json: unknown): CountryIncome[] {
  const [, rows] = wdiSchema.parse(json);
  return newest(
    rows.flatMap(({ country, countryiso3code, date, value }) =>
      value && value > 0 && /^[A-Z]{3}$/u.test(countryiso3code)
        ? [{ iso2: country.id, iso3: countryiso3code, year: Number(date), perCapitaUsd: value }]
        : [],
    ),
    (row) => row.iso2,
  );
}
