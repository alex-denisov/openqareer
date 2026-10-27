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
}
