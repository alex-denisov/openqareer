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
  CY: { limassol: 'Лимассола', nicosia: 'Никосии', larnaca: 'Ларнаки', paphos: 'Пафоса' },
  RS: { belgrade: 'Белграда', 'novi-sad': 'Нови-Сада' },
  AE: { dubai: 'Дубая', 'abu-dhabi': 'Абу-Даби' },
  GE: { tbilisi: 'Тбилиси', batumi: 'Батуми' },
};

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
