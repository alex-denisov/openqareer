import type { ApplicationStage } from './applicationStage';
import type { CandidateCompanyOpportunity, CandidateCompanyPage } from './candidateCompany';

/** B677: заявление источника, что компания помогает с переездом. */
export interface B640CompanyRelocation {
  readonly sourceLabel: string;
  readonly readAt: string | null;
}

export type B640CompanyItem = CandidateCompanyOpportunity & {
  readonly relocation: B640CompanyRelocation | null;
};

export interface B640CompanyCity {
  readonly name: string;
  readonly count: number;
}

/** Список компаний нового кабинета: прежний список плюс релокация и города. */
export interface B640CompanyPage extends Omit<CandidateCompanyPage, 'items' | 'filterCounts'> {
  readonly items: readonly B640CompanyItem[];
  readonly filterCounts: CandidateCompanyPage['filterCounts'] & { readonly relocation: number };
  readonly relocation: boolean;
  readonly city: string | null;
  /** Города компаний под текущим фильтром релокации, по убыванию числа. */
  readonly cities: readonly B640CompanyCity[];
}

/** Вакансии компании: строки подборки (`MatchedVacancyItem`) — тип даёт клиент. */
export interface B640CompanyCard<Row> {
  readonly company: B640CompanyItem;
  /** Вакансии по ролям кандидата: совпадение, деньги, формат; порция по 20. */
  readonly roleVacancies: readonly Row[];
  readonly roleTotal: number;
  readonly roleNextOffset: number | null;
  /** Другие вакансии компании в подборке (не по ролям), первые 20. */
  readonly otherVacancies: readonly Row[];
  readonly otherTotal: number;
  /** Статус отклика по id вакансии; вакансии без отклика нет в словаре. */
  readonly applications: Readonly<Record<string, ApplicationStage>>;
}

export type B640PersonCircle = 1 | 2 | 3;

/** Человек компании: знакомый, путь через знакомого или рекрутер. Контакты не отдаются. */
export interface B640CompanyPerson {
  readonly id: string;
  readonly circle: B640PersonCircle;
  /** Имя; участник платформы — без имени («Участник платформы»). */
  readonly name: string | null;
  readonly roleTitle: string | null;
  /** Почему этот человек: общее место работы, общий знакомый, рекрутер вакансии. */
  readonly evidence: string | null;
  readonly nextStep: 'write_known_contact' | 'ask_for_introduction' | 'cold_application';
  /** Вакансия, к которой ведёт действие строки. */
  readonly vacancyId: string;
  readonly platformMember: boolean;
  /** Кому и о чём черновик сообщения (B698); у участника платформы без имени — `null`. */
  readonly message: B640PersonMessage | null;
}

/** Адресат черновика: знакомый из сети или рекрутёр вакансии; тот же вид, что у POST /messages. */
export interface B640PersonMessage {
  readonly kind: 'known_contact' | 'ask_introduction' | 'recruiter';
  readonly target: { readonly contactId: string } | { readonly recruiterId: string; readonly vacancyId: string };
}

export interface B640CompanyPeoplePage {
  readonly items: readonly B640CompanyPerson[];
  readonly total: number;
  readonly offset: number;
  readonly nextOffset: number | null;
}
