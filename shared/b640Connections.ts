import type { B640PersonMessage } from './b640Companies';
import type { B640ContactList } from './b640Contacts';

/** B651 p11: контракт экрана «Связи» — связи кандидата по компаниям, круг и путь к человеку. */
export const B640_CONNECTION_PAGE_LIMIT = 20;
export const B640_CONNECTION_SEARCH_MAX = 120;

export interface B640Connection {
  readonly id: string;
  readonly fullName: string;
  readonly roleTitle: string;
  /** Компания; у связи без компании — пустая строка. */
  readonly companyName: string;
  readonly inSelection: boolean;
  /** Вакансия этой компании из подборки: к её письму ведёт строка. */
  readonly vacancyId: string | null;
  readonly circle: 1 | 2;
  /** 2-й круг: имя знакомого, который может представить; 1-й — null. */
  readonly via: string | null;
  /** Кому и о чём черновик; платформа ничего не отправляет. */
  readonly message: B640PersonMessage;
}

export interface B640ConnectionList {
  readonly items: readonly B640Connection[];
  /** Найдено по запросу и отметке «Только компании из подборки». */
  readonly total: number;
  /** Все связи кандидата, без учёта запроса. */
  readonly connections: number;
  /** В скольких компаниях подборки есть знакомые. */
  readonly selectionCompanies: number;
  /** Подборка ещё считается: отметки и счёт появятся при следующем чтении. */
  readonly selectionPending: boolean;
  readonly offset: number;
  readonly nextOffset: number | null;
  readonly linkedinImport: B640ContactList['linkedinImport'];
}
