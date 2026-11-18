import type { VacancyFitView } from './vacancyFit';

/** B676: «Своя вакансия» — кандидат приносит ссылку или текст; вакансия видна только ему. */
export type OwnVacancyWorkFormat = 'remote' | 'hybrid' | 'office';
export interface OwnVacancy {
  readonly id: string;
  readonly title: string;
  readonly company: string | null;
  readonly location: string | null;
  readonly workFormat: OwnVacancyWorkFormat | null;
  /** Адрес, по которому прочитана; null — вставлен текст. */
  readonly url: string | null;
  readonly createdAt: string;
  /** Сколько требований вакансии есть в профиле; null — требований не нашлось или сравнение ещё идёт. */
  readonly coverage: { readonly matched: number; readonly total: number } | null;
  readonly comparing: boolean;
}
export interface OwnVacancyDetail extends OwnVacancy {
  readonly text: string;
  readonly fit: VacancyFitView;
}
export type OwnVacancyUnreadable = 'site_closed' | 'failed' | 'thin';
export type OwnVacancyCreateResult =
  | { readonly outcome: 'created'; readonly vacancy: OwnVacancy }
  | { readonly outcome: 'in_pool'; readonly clusterId: string }
  | { readonly outcome: 'unreadable'; readonly reason: OwnVacancyUnreadable }
  | { readonly outcome: 'limit' };
export const OWN_VACANCY_ID_PREFIX = 'own-';
export const OWN_VACANCY_MAX = 50;
export const OWN_VACANCY_TEXT_MIN = 40;
export const OWN_VACANCY_TEXT_MAX = 30_000;
export const OWN_VACANCY_LINK_MAX = 2048;
/** Текст страницы короче этого — «thin»: вакансии на странице нет. */
export const OWN_VACANCY_PAGE_TEXT_MIN = 400;
export const OWN_VACANCY_TITLE_MAX = 160;
export const OWN_VACANCY_USER_AGENT = 'openqareer/1.0 (+https://openqareer.com)';
