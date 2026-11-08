import { CITY_NAMES } from './locationGazetteer';

/**
 * B351 06b «Где искать»: catalog places of each salary country, with the
 * genitive the call to action needs («вакансий Берлина»). Counts come from
 * the open catalog; a city under MIN_COUNTRY_CITY_VACANCIES is not shown.
 */
export const MIN_COUNTRY_CITY_VACANCIES = 30;

export const SALARY_COUNTRY_CITIES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  DE: {
    berlin: 'Берлина',
    munich: 'Мюнхена',
    hamburg: 'Гамбурга',
    frankfurt: 'Франкфурта',
    cologne: 'Кёльна',
    stuttgart: 'Штутгарта',
    dusseldorf: 'Дюссельдорфа',
  },
  CY: { limassol: 'Лимасола', nicosia: 'Никосии', larnaca: 'Ларнаки', paphos: 'Пафоса' },
  RS: { belgrade: 'Белграда', 'novi-sad': 'Нови-Сада' },
  AE: { dubai: 'Дубая', 'abu-dhabi': 'Абу-Даби' },
  GE: { tbilisi: 'Тбилиси', batumi: 'Батуми' },
  US: {
    'new-york': 'Нью-Йорка',
    'san-francisco': 'Сан-Франциско',
    seattle: 'Сиэтла',
    austin: 'Остина',
    boston: 'Бостона',
    chicago: 'Чикаго',
    'los-angeles': 'Лос-Анджелеса',
  },
};

/** Russian city name by catalog slug, from the shared gazetteer; the catalog label when absent. */
const COUNTRY_CITY_NAMES: Readonly<Record<string, string>> = {
  cologne: 'Кёльн',
  stuttgart: 'Штутгарт',
  dusseldorf: 'Дюссельдорф',
  nicosia: 'Никосия',
  larnaca: 'Ларнака',
  paphos: 'Пафос',
  'novi-sad': 'Нови-Сад',
  batumi: 'Батуми',
  'new-york': 'Нью-Йорк',
  'san-francisco': 'Сан-Франциско',
  seattle: 'Сиэтл',
  austin: 'Остин',
  boston: 'Бостон',
  chicago: 'Чикаго',
  'los-angeles': 'Лос-Анджелес',
};
export function russianCityName(slug: string, label: string): string {
  return (
    CITY_NAMES[slug.replace(/-/gu, ' ')] ??
    COUNTRY_CITY_NAMES[slug] ??
    CITY_NAMES[label.toLowerCase()] ??
    label
  );
}

export interface CountryCityCount {
  readonly slug: string;
  readonly label: string;
  readonly count: number;
}
export interface CountryCatalog {
  readonly cities: readonly CountryCityCount[];
  /** ISO time the counts were read. */
  readonly readAt: string;
  /** Pool salary figure; absent below MIN_COUNTRY_POOL_SAMPLE ranges. */
  readonly pay?: CountryPoolPay;
}

/** SEO P2: fewer «от — до» ranges than this for a country is not a market figure. */
export const MIN_COUNTRY_POOL_SAMPLE = 30;
export type PoolPayPeriod = 'month' | 'year';
/** Median of range midpoints over the country's catalog cities, with its sample and date. */
export interface CountryPoolPay {
  readonly median: number;
  readonly low: number;
  readonly high: number;
  readonly sign: string;
  readonly period: PoolPayPeriod;
  /** Ranges in the published currency+period group. */
  readonly sampleSize: number;
  /** Vacancies of the cities that state any salary. */
  readonly withSalary: number;
  readonly readAt: string;
  /** Source boards of the counted vacancies (source_name). */
  readonly sources: readonly string[];
}
