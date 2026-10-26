/**
 * Wave 1 of the Country Fit expansion: official 2026 rates read on 2026-10-26.
 * The table «страна × источник» is in the PR description.
 */
import { unavailableCostOfLiving } from './costOfLiving';
import type { CountryTaxData, TaxDataSource } from './types';

const retrievedAt = '2026-10-26';

const source = (title: string, url: string, dataYear = 2026): TaxDataSource => ({
  title,
  url,
  dataYear,
  retrievedAt,
});

const gbIncomeTax = source(
  'GOV.UK: ставки и необлагаемый минимум подоходного налога 2026–27',
  'https://www.gov.uk/government/publications/rates-and-allowances-income-tax/income-tax-rates-and-allowances-current-and-past',
);
const gbNationalInsurance = source(
  'GOV.UK: пороги и ставки National Insurance для работодателей 2026–27',
  'https://www.gov.uk/guidance/rates-and-thresholds-for-employers-2026-to-2027',
);
const kzTaxCode = source(
  'Налоговый кодекс РК, ст. 363, 402, 403: ставки ИПН и вычеты',
  'https://adilet.zan.kz/rus/docs/K2500000214',
);
const kzSocialCode = source(
  'Социальный кодекс РК, ст. 249: ставка и предел обязательных пенсионных взносов',
  'https://adilet.zan.kz/rus/docs/K2300000224',
);
const kzHealthInsurance = source(
  'Закон РК об обязательном социальном медицинском страховании, ст. 28: взнос работника и предел дохода',
  'https://adilet.zan.kz/rus/docs/Z1500000405',
);
const amTaxCode = source(
  'Налоговый кодекс Армении, ст. 150: ставка подоходного налога',
  'https://www.arlis.am/hy/acts/230455',
);
const amFundedPension = source(
  'Закон Армении о накопительных пенсиях, ст. 5–6: социальный платёж',
  'https://www.arlis.am/hy/acts/224823',
);
const amStampFee = source(
  'Закон Армении о возмещении вреда военнослужащим, ст. 11–12: дрошманишаин вчар',
  'https://www.arlis.am/hy/acts/230046',
);
const trTariff = source(
  'GİB: тариф подоходного налога 2026, шкала для зарплаты',
  'https://cdn.gib.gov.tr/api/gibportal-file/file/getFileResources?objectKey=arsiv%2Fyardim-kaynaklar%2Fyararli-bilgiler%2Fgelir-vergisi-tarifeleri%2Fgelir-vergisi-tarifesi-2026.pdf',
);
const trSocialSecurity = source(
  'SGK: минимальная и максимальная база взносов на 2026 год',
  'https://www.sgk.gov.tr/Content/Post/2e0c9e1a-2cfe-4456-af10-49d3de0c58ba/Prime-Esas-Kazanc-Miktarlari-2026-01-14-10-35-39',
);
const trStampDuty = source(
  'Закон Турции о гербовом сборе № 488: ставка 7,59‰ на зарплату и освобождение минимальной зарплаты',
  'https://www.mevzuat.gov.tr/mevzuat?MevzuatNo=488&MevzuatTur=1&MevzuatTertip=5',
);
const uzTaxCode = source(
  'Налоговый кодекс Узбекистана, ст. 381 и 385: ставка 12% и пенсионный взнос из налога',
  'https://lex.uz/ru/docs/4674893',
);
const byTaxCode = source(
  'Налоговый кодекс Беларуси (Особенная часть), ст. 209 и 214: вычет и ставки подоходного налога',
  'https://pravo.by/document/?guid=3871&p0=hk0900071',
);
const bySocialFund = source(
  'Закон Беларуси о взносах в ФСЗН, ст. 5: 1% работающего гражданина',
  'https://pravo.by/document/?guid=3871&p0=H12100118',
);
const meIncomeTax = source(
  'Службени лист Черногории 160/2025: ставки налога на доход с 1 января 2026 года',
  'https://www.sluzbenilist.me/propisi/389429',
);
const mePension = source(
  'Службени лист Черногории 94/2024: пенсионный взнос работника 10%',
  'https://www.sluzbenilist.me/propisi/373700',
);
/** The 2026 ceiling is not published yet (26.10); the latest one, for 2025, is applied. */
const mePensionCeiling = source(
  'Министерство финансов Черногории: наибольшая годовая база пенсионного взноса 75 453 € (за 2025 год, за 2026 год ещё не опубликована)',
  'https://www.sluzbenilist.me/propisi/387933',
  2025,
);
const meUnemployment = source(
  'Закон Черногории о взносах, ст. 18: взнос работника на страхование от безработицы 0,5%',
  'https://wapi.gov.me/download/280ab36d-2ff7-4f06-aab5-0d2ca2af1875?version=1.0',
);

/** Montenegro taxes monthly gross pay: 0 % to 700 €, 9 % to 1 000 €, 15 % above. */
const montenegroMonthlyBand = (monthly: number): number => monthly * 12;

export const waveOneTaxData = {
  AM: {
    code: 'AM',
    name: 'Армения',
    currency: 'AMD',
    taxYear: 2026,
    incomeTax: { kind: 'flat', rate: 0.2, source: amTaxCode },
    employeeContributions: [
      {
        name: 'Накопительная пенсия: 5% до 500 000 ֏',
        rate: 0.05,
        monthlyCap: 500_000,
        source: amFundedPension,
      },
      {
        name: 'Накопительная пенсия: 10% сверх 500 000 ֏',
        rate: 0.1,
        monthlyExemptUpTo: 500_000,
        monthlyCap: 1_125_000,
        source: amFundedPension,
      },
      {
        name: 'Взнос в фонд страхования военнослужащих',
        rate: 0,
        monthlyFixedBands: [
          { upTo: 1_000_000, amount: 1_000 },
          { upTo: null, amount: 15_000 },
        ],
        source: amStampFee,
      },
    ],
    costOfLiving: unavailableCostOfLiving,
  },
  KZ: {
    code: 'KZ',
    name: 'Казахстан',
    currency: 'KZT',
    taxYear: 2026,
    incomeTax: {
      kind: 'brackets',
      bands: [
        { upTo: 36_762_500, rate: 0.1 },
        { upTo: null, rate: 0.15 },
      ],
      source: kzTaxCode,
    },
    employeeContributions: [
      {
        name: 'Обязательные пенсионные взносы',
        rate: 0.1,
        monthlyCap: 4_250_000,
        source: kzSocialCode,
      },
      {
        name: 'Взносы на медицинское страхование',
        rate: 0.02,
        monthlyCap: 1_700_000,
        source: kzHealthInsurance,
      },
    ],
    costOfLiving: unavailableCostOfLiving,
  },
  TR: {
    code: 'TR',
    name: 'Турция',
    currency: 'TRY',
    taxYear: 2026,
    incomeTax: {
      kind: 'brackets-minus-exempt-base',
      bands: [
        { upTo: 190_000, rate: 0.15 },
        { upTo: 400_000, rate: 0.2 },
        { upTo: 1_500_000, rate: 0.27 },
        { upTo: 5_300_000, rate: 0.35 },
        { upTo: null, rate: 0.4 },
      ],
      exemptAnnualBase: 336_906,
      source: trTariff,
    },
    employeeContributions: [
      {
        name: 'Социальное страхование (SGK)',
        rate: 0.14,
        monthlyCap: 297_270,
        source: trSocialSecurity,
      },
      {
        name: 'Страхование от безработицы',
        rate: 0.01,
        monthlyCap: 297_270,
        source: trSocialSecurity,
      },
      {
        name: 'Гербовый сбор',
        rate: 0.00759,
        annualExemptUpTo: 396_360,
        source: trStampDuty,
      },
    ],
    costOfLiving: unavailableCostOfLiving,
  },
  UZ: {
    code: 'UZ',
    name: 'Узбекистан',
    currency: 'UZS',
    taxYear: 2026,
    incomeTax: { kind: 'flat', rate: 0.12, source: uzTaxCode },
    employeeContributions: [],
    costOfLiving: unavailableCostOfLiving,
  },
  BY: {
    code: 'BY',
    name: 'Беларусь',
    currency: 'BYN',
    taxYear: 2026,
    incomeTax: {
      kind: 'brackets',
      bands: [
        { upTo: 350_000, rate: 0.13 },
        { upTo: 600_000, rate: 0.25 },
        { upTo: null, rate: 0.3 },
      ],
      source: byTaxCode,
    },
    employeeContributions: [{ name: 'Пенсионное страхование', rate: 0.01, source: bySocialFund }],
    costOfLiving: unavailableCostOfLiving,
  },
  ME: {
    code: 'ME',
    name: 'Черногория',
    currency: 'EUR',
    taxYear: 2026,
    incomeTax: {
      kind: 'brackets',
      bands: [
        { upTo: montenegroMonthlyBand(700), rate: 0 },
        { upTo: montenegroMonthlyBand(1_000), rate: 0.09 },
        { upTo: null, rate: 0.15 },
      ],
      source: meIncomeTax,
    },
    employeeContributions: [
      {
        name: 'Пенсионное и инвалидное страхование',
        rate: 0.1,
        annualCap: 75_453,
        source: mePension,
        capSource: mePensionCeiling,
      },
      {
        name: 'Страхование от безработицы',
        rate: 0.005,
        source: meUnemployment,
      },
    ],
    costOfLiving: unavailableCostOfLiving,
  },
  GB: {
    code: 'GB',
    name: 'Великобритания',
    currency: 'GBP',
    taxYear: 2026,
    incomeTax: {
      kind: 'brackets',
      bands: [
        { upTo: 37_700, rate: 0.2 },
        { upTo: 125_140, rate: 0.4 },
        { upTo: null, rate: 0.45 },
      ],
      source: gbIncomeTax,
    },
    employeeContributions: [
      {
        name: 'National Insurance: 8% от £12 570 до £50 270',
        rate: 0.08,
        annualExemptUpTo: 12_570,
        annualCap: 50_270,
        source: gbNationalInsurance,
      },
      {
        name: 'National Insurance: 2% свыше £50 270',
        rate: 0.02,
        annualExemptUpTo: 50_270,
        source: gbNationalInsurance,
      },
    ],
    costOfLiving: unavailableCostOfLiving,
  },
} as const satisfies Record<'AM' | 'KZ' | 'TR' | 'UZ' | 'BY' | 'ME' | 'GB', CountryTaxData>;
