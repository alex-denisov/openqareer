import { numbeoTerms } from './costOfLiving';
import type { CountryCode, CountryTaxData, TaxDataSource } from './types';
import { waveOneTaxData } from './waveOneTaxData';

const retrievedAt = '2026-10-10';

const source = (title: string, url: string, dataYear = 2026): TaxDataSource => ({
  title,
  url,
  dataYear,
  retrievedAt,
});

const countryData = {
  DE: {
    code: 'DE',
    name: 'Германия',
    currency: 'EUR',
    taxYear: 2026,
    incomeTax: {
      kind: 'germany-2026',
      source: source(
        'Einkommensteuergesetz, § 32a: тариф налога на доходы за 2026 год',
        'https://www.gesetze-im-internet.de/estg/__32a.html',
      ),
    },
    employeeContributions: [
      {
        name: 'Пенсионное страхование',
        rate: 0.093,
        annualCap: 101_400,
        source: source(
          'Deutsche Rentenversicherung: значения пенсионного страхования 2026',
          'https://www.deutsche-rentenversicherung.de/DRV/DE/Experten/Zahlen-und-Fakten/Werte-der-Rentenversicherung/werte-der-rentenversicherung_node.html',
        ),
      },
      {
        name: 'Страхование от безработицы',
        rate: 0.013,
        annualCap: 101_400,
        source: source(
          'Bundesregierung: страховые пределы 2026; Arbeitnehmeranteil по ставке 2,6%',
          'https://www.bundesregierung.de/breg-de/suche/beitragsgemessungsgrenzen-2386514',
        ),
      },
      {
        name: 'Медицинское страхование',
        rate: 0.0875,
        annualCap: 69_750,
        source: source(
          'Bundesgesundheitsministerium: средняя дополнительная ставка и предел 2026',
          'https://www.bundesgesundheitsministerium.de/beitraege',
        ),
      },
      {
        name: 'Страхование по уходу',
        rate: 0.018,
        annualCap: 69_750,
        source: source(
          'Deutsche Rentenversicherung: взносы в социальное страхование 2026',
          'https://www.deutsche-rentenversicherung.de/DRV/DE/Experten/Zahlen-und-Fakten/Werte-der-Rentenversicherung/werte-der-rentenversicherung_node.html',
        ),
      },
      {
        name: 'Надбавка по уходу для бездетных',
        rate: 0.006,
        annualCap: 69_750,
        eligibility: 'germany-childless',
        source: source(
          'Deutsche Rentenversicherung: надбавка для бездетных работников',
          'https://www.deutsche-rentenversicherung.de/DRV/DE/Experten/Zahlen-und-Fakten/Werte-der-Rentenversicherung/werte-der-rentenversicherung_node.html',
        ),
      },
    ],
    costOfLiving: {
      monthlyRent: null,
      monthlyPrivateHealthInsurance: null,
      unavailableReason:
        'Нет проверенного открытого набора ежемесячной аренды. Коммерческие данные Numbeo не включены без лицензии; частный страховой тариф зависит от плана и возраста.',
      licensingSource: numbeoTerms,
    },
  },
  CY: {
    code: 'CY',
    name: 'Кипр',
    currency: 'EUR',
    taxYear: 2026,
    incomeTax: {
      kind: 'brackets',
      bands: [
        { upTo: 22_000, rate: 0 },
        { upTo: 32_000, rate: 0.2 },
        { upTo: 42_000, rate: 0.25 },
        { upTo: 72_000, rate: 0.3 },
        { upTo: null, rate: 0.35 },
      ],
      source: source(
        'Tax Department: налоговые шкалы физических лиц с 2026 года',
        'https://www.gov.cy/mof-tax/documents/forologiki-dilosi-eisodimatos-atomoy/',
      ),
    },
    employeeContributions: [
      {
        name: 'Социальное страхование',
        rate: 0.088,
        annualCap: 68_904,
        source: source(
          'Social Insurance Services: максимум страхуемого заработка за 2026 год',
          'https://sisweb.mlsi.gov.cy/anotato2025/',
        ),
      },
      {
        name: 'Взнос в систему здравоохранения GeSY',
        rate: 0.0265,
        annualCap: 180_000,
        source: source(
          'Tax Department: взносы GeSY и максимальный доход €180 000',
          'https://www.gov.cy/mof-tax/documents/geniko-systima-ygeias-gesy/',
        ),
      },
    ],
    costOfLiving: {
      monthlyRent: null,
      monthlyPrivateHealthInsurance: null,
      unavailableReason:
        'Нет проверенного открытого набора ежемесячной аренды. Коммерческие данные Numbeo не включены без лицензии; частный страховой тариф зависит от плана и возраста.',
      licensingSource: numbeoTerms,
    },
  },
  RS: {
    code: 'RS',
    name: 'Сербия',
    currency: 'RSD',
    taxYear: 2026,
    incomeTax: {
      kind: 'flat-after-monthly-allowance',
      rate: 0.1,
      monthlyAllowance: 34_221,
      source: source(
        'Tax Administration: необлагаемая часть зарплаты с 1 января 2026 года',
        'https://www.purs.gov.rs/upload/media/2025/11/24/760462/Law_on_personal_income_tax.pdf',
      ),
    },
    employeeContributions: [
      {
        name: 'Пенсионное и инвалидное страхование',
        rate: 0.14,
        monthlyCap: 732_820,
        monthlyFloor: 51_297,
        source: source(
          'Pension and Disability Insurance Fund: максимальная база взноса 2026 года',
          'https://www.pio.rs/en/node/2412',
        ),
      },
      {
        name: 'Медицинское страхование',
        rate: 0.0515,
        monthlyCap: 732_820,
        monthlyFloor: 51_297,
        source: source(
          'Tax Administration: ставки взносов и минимальная база за 2026 год',
          'https://purs.gov.rs/upload/media/2026/4/15/760703/Tax_bulletins_for_natural_persons_who_are_self_-_employed_-april_2026.pdf',
        ),
      },
      {
        name: 'Страхование от безработицы',
        rate: 0.0075,
        monthlyCap: 732_820,
        monthlyFloor: 51_297,
        source: source(
          'Закон о взносах на обязательное социальное страхование, статья 44',
          'https://pravno-informacioni-sistem.rs/eli/rep/sgrs/skupstina/zakon/2004/84/7/reg',
        ),
      },
    ],
    costOfLiving: {
      monthlyRent: null,
      monthlyPrivateHealthInsurance: null,
      unavailableReason:
        'Нет проверенного открытого набора ежемесячной аренды. Коммерческие данные Numbeo не включены без лицензии; частный страховой тариф зависит от плана и возраста.',
      licensingSource: numbeoTerms,
    },
  },
  AE: {
    code: 'AE',
    name: 'ОАЭ',
    currency: 'AED',
    taxYear: 2026,
    incomeTax: {
      kind: 'none',
      source: source(
        'Официальный портал ОАЭ: подоходный налог с физических лиц не взимается',
        'https://u.ae/en/information-and-services/finance-and-investment/taxation/other-taxes',
      ),
    },
    employeeContributions: [],
    costOfLiving: {
      monthlyRent: null,
      monthlyPrivateHealthInsurance: null,
      unavailableReason:
        'Суммы зависят от эмирата, страхового плана и статуса работника. Коммерческие данные Numbeo не включены без лицензии.',
      licensingSource: numbeoTerms,
    },
  },
  GE: {
    code: 'GE',
    name: 'Грузия',
    currency: 'GEL',
    taxYear: 2026,
    incomeTax: {
      kind: 'flat',
      rate: 0.2,
      source: source(
        'Налоговый кодекс Грузии, статья 81: ставка подоходного налога',
        'https://www.matsne.gov.ge/en/document/view/1043717?publication=246',
      ),
    },
    employeeContributions: [
      {
        name: 'Накопительная пенсионная схема работника',
        rate: 0.02,
        eligibility: 'georgia-pension-member',
        source: source(
          'Pension Fund of Georgia: размер взноса участника',
          'https://www.pensions.ge/public-information/faq',
        ),
      },
    ],
    costOfLiving: {
      monthlyRent: null,
      monthlyPrivateHealthInsurance: null,
      unavailableReason:
        'Нет проверенного открытого набора ежемесячной аренды. Коммерческие данные Numbeo не включены без лицензии; частный страховой тариф зависит от плана и возраста.',
      licensingSource: numbeoTerms,
    },
  },
  RU: {
    code: 'RU',
    name: 'Россия',
    currency: 'RUB',
    taxYear: 2026,
    incomeTax: {
      kind: 'brackets',
      bands: [
        { upTo: 2_400_000, rate: 0.13 },
        { upTo: 5_000_000, rate: 0.15 },
        { upTo: 20_000_000, rate: 0.18 },
        { upTo: 50_000_000, rate: 0.2 },
        { upTo: null, rate: 0.22 },
      ],
      source: source(
        'ФНС России: ставки НДФЛ по основной налоговой базе в 2026 году',
        'https://www.nalog.gov.ru/rn26/news/activities_fts/16653428/',
      ),
    },
    employeeContributions: [],
    costOfLiving: {
      monthlyRent: null,
      monthlyPrivateHealthInsurance: null,
      unavailableReason:
        'Нет проверенного открытого набора ежемесячной аренды. Коммерческие данные Numbeo не включены без лицензии; обязательные социальные взносы работодателя не удерживаются из зарплаты работника.',
      licensingSource: numbeoTerms,
    },
  },
  ...waveOneTaxData,
} as const satisfies Record<CountryCode, CountryTaxData>;

export const supportedCountryCodes = Object.keys(countryData) as CountryCode[];

export function getCountryTaxData(countryCode: string): CountryTaxData {
  const data = countryData[countryCode as CountryCode];
  if (!data) throw new Error('Страна не поддерживается');
  return data;
}

/** Every official source behind a country's payroll: tax, contributions and separately published ceilings. */
export function payrollSources(data: CountryTaxData): TaxDataSource[] {
  const all = [
    data.incomeTax.source,
    ...(data.incomeTaxSurtax ? [data.incomeTaxSurtax.source] : []),
    ...data.employeeContributions.flatMap((item) =>
      item.capSource ? [item.source, item.capSource] : [item.source],
    ),
  ];
  return [...new Map(all.map((source) => [source.url, source])).values()];
}
