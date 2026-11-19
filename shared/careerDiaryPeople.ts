/**
 * B685: карта людей на новом месте (экран d01d). Люди хранятся по месту работы,
 * имена и роли зашифрованы и видны только самому кандидату. Встреча с человеком —
 * задача плана адаптации шага «Карта людей».
 */
export const PEOPLE_CADENCES = ['weekly', 'biweekly', 'monthly', 'on_demand'] as const;
export type CareerDiaryPeopleCadence = (typeof PEOPLE_CADENCES)[number];

export const PEOPLE_MAX = 100;
export const PERSON_NAME_MAX = 120;
export const PERSON_ROLE_MAX = 160;
export const PEOPLE_GROUP_MAX = 80;
export const PERSON_HEADCOUNT_MAX = 500;

/** Что кандидат вводит о человеке или группе людей («Ещё 8 человек»). */
export interface CareerDiaryPersonInput {
  readonly name: string;
  readonly role: string;
  /** «Руководитель», «Команда», «Соседние команды» или своё название. */
  readonly group: string;
  readonly cadence: CareerDiaryPeopleCadence;
  /** Сколько людей за строкой: 1 — один человек. */
  readonly headcount: number;
  readonly lastMetOn: string | null;
}

export interface CareerDiaryPersonMeeting {
  readonly taskId: string;
  readonly date: string;
}

export interface CareerDiaryPerson extends CareerDiaryPersonInput {
  readonly id: string;
  readonly meeting: CareerDiaryPersonMeeting | null;
  readonly createdAt: string;
}

/** `met` — встреча была, `scheduled` — назначена в плане, `none` — без встречи. */
export type CareerDiaryPersonStatus = 'met' | 'scheduled' | 'none';

export interface CareerDiaryPersonView extends CareerDiaryPerson {
  readonly status: CareerDiaryPersonStatus;
}

export interface CareerDiaryPeopleGroup {
  readonly name: string;
  readonly headcount: number;
  readonly people: readonly CareerDiaryPersonView[];
}

export interface CareerDiaryPeopleMap {
  readonly workplaceId: string;
  /** Людей всего, с учётом строк «Ещё N человек». */
  readonly total: number;
  /** Людей, с которыми не было и не назначено встречи. */
  readonly withoutMeeting: number;
  /** Ближайшая назначенная встреча. */
  readonly nextMeeting: { readonly personId: string; readonly date: string } | null;
  readonly groups: readonly CareerDiaryPeopleGroup[];
}
