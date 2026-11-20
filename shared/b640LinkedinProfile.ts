/**
 * B692/B645 (a03): разделы профиля LinkedIn — «сейчас» из импорта LinkedIn и предложения по ним.
 * На LinkedIn ничего не отправляется: кандидат копирует текст сам и отмечает «Выполнено».
 */
export const LINKEDIN_SECTIONS = [
  'headline',
  'about',
  'experience',
  'education',
  'courses',
  'skills',
  'languages',
] as const;
export type LinkedinSection = (typeof LINKEDIN_SECTIONS)[number];

/** Лимиты LinkedIn на заголовок и «О себе»; на навыки — сколько LinkedIn принимает. */
export const LINKEDIN_HEADLINE_MAX = 220;
export const LINKEDIN_ABOUT_MAX = 2600;
export const LINKEDIN_SKILLS_MAX = 50;
/**
 * Вариантов у предложения не больше трёх, считая первый (решение владельца 12.11 по генерации):
 * первый бесплатно, «Предложить заново» — ещё два; квоты тарифа это не тратит.
 */
export const LINKEDIN_VARIANTS_MAX = 3;

/**
 * Ключ предложения: раздел или место работы `experience:<id>`. По нему ставится «Выполнено»
 * и просится другой вариант.
 */
export const LINKEDIN_OFFER_KEY = /^(headline|about|skills|experience:[A-Za-z0-9_.:-]{1,120})$/u;

export interface LinkedinOffer {
  readonly key: string;
  /** Все варианты по порядку, первый — исходное предложение; на экране листаются «Вариант N из 3». */
  readonly variants: readonly string[];
  /** Кандидат вставил текст в LinkedIn и отметил «Выполнено». */
  readonly doneAt: string | null;
}

/** Место работы в «Опыте»: «Компания · Должность», что сейчас и предложение. */
export interface LinkedinPlace {
  readonly id: string;
  readonly label: string;
  readonly current: string | null;
  readonly offer: LinkedinOffer | null;
}

export interface LinkedinSectionView {
  readonly id: LinkedinSection;
  /** Короткая строка из импорта LinkedIn; у «Опыта» — по местам работы в `places`. */
  readonly current: string | null;
  readonly offer: LinkedinOffer | null;
  readonly places?: readonly LinkedinPlace[];
}

export type LinkedinProfileView =
  | { readonly kind: 'no_import' }
  | {
      readonly kind: 'ready';
      readonly sections: readonly LinkedinSectionView[];
      /** Пересказ «О себе» и «Опыта» ещё пишется: клиент перечитывает экран, пока не станет false. */
      readonly rewriting: boolean;
    };

/** `POST …/linkedin/profile/done`: отметить «Выполнено» сразу несколько предложений. */
export interface LinkedinDoneResult {
  readonly done: Readonly<Record<string, string>>;
}
