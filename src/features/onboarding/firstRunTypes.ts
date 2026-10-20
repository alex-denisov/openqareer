import type { CandidateRegion } from '../workspace/candidateRegions';

export type FirstRunStep = 'goal' | 'source' | 'context';

export type SourceType = 'linkedin' | 'hh' | 'file' | 'talk';

export interface FirstRunCity {
  readonly name: string;
  readonly country: string;
  readonly region?: CandidateRegion;
}

export type WorkFormat = '' | 'Гибрид' | 'Удалённо' | 'Офис';

export interface FirstRunContext {
  readonly city: string;
  readonly country: string;
  readonly region?: CandidateRegion;
  readonly format: WorkFormat;
  readonly isRelocationReady: boolean;
}

export interface FirstRunData {
  readonly goal: string;
  readonly selectedSource: SourceType | null;
  readonly isSourceSkipped: boolean;
  readonly context: FirstRunContext;
}

export const POPULAR_CITIES: readonly FirstRunCity[] = [
  { name: 'Москва', country: 'Россия', region: 'ru' },
  { name: 'Санкт-Петербург', country: 'Россия', region: 'ru' },
  { name: 'Новосибирск', country: 'Россия', region: 'ru' },
  { name: 'Екатеринбург', country: 'Россия', region: 'ru' },
  { name: 'Казань', country: 'Россия', region: 'ru' },
  { name: 'Ереван', country: 'Армения', region: 'cis' },
  { name: 'Белград', country: 'Сербия', region: 'eu' },
];

export const CITY_DIRECTORY: readonly FirstRunCity[] = [
  ...POPULAR_CITIES,
  { name: 'Нижний Новгород', country: 'Россия', region: 'ru' },
  { name: 'Краснодар', country: 'Россия', region: 'ru' },
  { name: 'Самара', country: 'Россия', region: 'ru' },
  { name: 'Ростов-на-Дону', country: 'Россия', region: 'ru' },
  { name: 'Алматы', country: 'Казахстан', region: 'cis' },
  { name: 'Астана', country: 'Казахстан', region: 'cis' },
  { name: 'Тбилиси', country: 'Грузия', region: 'cis' },
  { name: 'Ташкент', country: 'Узбекистан', region: 'cis' },
  { name: 'Минск', country: 'Беларусь', region: 'cis' },
  { name: 'Баку', country: 'Азербайджан', region: 'cis' },
  { name: 'Лимассол', country: 'Кипр', region: 'eu' },
  { name: 'Берлин', country: 'Германия', region: 'eu' },
  { name: 'Мюнхен', country: 'Германия', region: 'eu' },
  { name: 'Лондон', country: 'Великобритания', region: 'eu' },
  { name: 'Париж', country: 'Франция', region: 'eu' },
  { name: 'Амстердам', country: 'Нидерланды', region: 'eu' },
  { name: 'Мадрид', country: 'Испания', region: 'eu' },
  { name: 'Барселона', country: 'Испания', region: 'eu' },
  { name: 'Варшава', country: 'Польша', region: 'eu' },
  { name: 'Вена', country: 'Австрия', region: 'eu' },
  { name: 'Прага', country: 'Чехия', region: 'eu' },
  { name: 'Дубай', country: 'ОАЭ', region: 'mena' },
  { name: 'Абу-Даби', country: 'ОАЭ', region: 'mena' },
  { name: 'Эр-Рияд', country: 'Саудовская Аравия', region: 'mena' },
  { name: 'Доха', country: 'Катар', region: 'mena' },
  { name: 'Тель-Авив', country: 'Израиль', region: 'mena' },
  { name: 'Стамбул', country: 'Турция', region: 'mena' },
  { name: 'Сингапур', country: 'Сингапур', region: 'apac' },
  { name: 'Токио', country: 'Япония', region: 'apac' },
  { name: 'Сидней', country: 'Австралия', region: 'apac' },
  { name: 'Нью-Йорк', country: 'США', region: 'us' },
  { name: 'Сан-Франциско', country: 'США', region: 'us' },
  { name: 'Сиэтл', country: 'США', region: 'us' },
  { name: 'Остин', country: 'США', region: 'us' },
  { name: 'Бостон', country: 'США', region: 'us' },
  { name: 'Торонто', country: 'Канада', region: 'us' },
  { name: 'Сан-Паулу', country: 'Бразилия', region: 'latam' },
  { name: 'Буэнос-Айрес', country: 'Аргентина', region: 'latam' },
];

export const DEFAULT_FIRST_RUN_DATA: FirstRunData = {
  goal: '',
  selectedSource: 'linkedin',
  isSourceSkipped: false,
  context: {
    city: '',
    country: '',
    format: '',
    isRelocationReady: false,
  },
};
