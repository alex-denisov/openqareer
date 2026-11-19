/**
 * B697: контракт экрана «Контакты» нового кабинета B640 — поиск, фильтры, сортировка и
 * статус «писали / ответили» на сервере. Почта и телефон контакта в ответ не попадают.
 */
export const B640_CONTACT_PAGE_LIMIT_MAX = 20;
export const B640_CONTACT_SEARCH_MAX = 120;
export const B640_CONTACT_LINKS = ['direct', 'intro', 'none'] as const;
export type B640ContactLink = (typeof B640_CONTACT_LINKS)[number];
export const B640_CONTACT_STATES = ['none', 'written', 'replied'] as const;
export type B640ContactState = (typeof B640_CONTACT_STATES)[number];
export const B640_CONTACT_SORTS = ['selection', 'recent', 'name'] as const;
export type B640ContactSort = (typeof B640_CONTACT_SORTS)[number];

export interface B640ContactStatus {
  readonly state: B640ContactState;
  /** Когда статус выставлен, ISO; у `none` — null. */
  readonly at: string | null;
}

export interface B640Contact {
  readonly id: string;
  readonly fullName: string;
  readonly roleTitle: string;
  readonly companyName: string;
  readonly link: B640ContactLink;
  /** Короткая строка о связи для экрана; нет основания — null. */
  readonly linkNote: string | null;
  readonly status: B640ContactStatus;
  /** Компания контакта есть в текущей подборке кандидата. */
  readonly inSelection: boolean;
}

export interface B640ContactFacets {
  readonly companies: readonly { readonly name: string; readonly count: number }[];
  readonly link: Readonly<Record<B640ContactLink, number>>;
  readonly status: Readonly<Record<B640ContactState, number>>;
}

export interface B640ContactList {
  readonly items: readonly B640Contact[];
  readonly total: number;
  readonly offset: number;
  readonly nextOffset: number | null;
  readonly facets: B640ContactFacets;
  readonly linkedinImport: {
    readonly state: 'imported' | 'unknown';
    readonly importedAt: string | null;
    readonly importedCount: number | null;
  };
}

/** `PUT /api/v1/candidate/b640/contacts/:contactId/status`: `data`. */
export interface B640ContactStatusResult {
  readonly contactId: string;
  readonly state: B640ContactState;
  readonly at: string | null;
}
