import type { B640Contact, B640ContactList, B640ContactSort, B640ContactState, B640ContactStatusResult } from '../../../../../shared/b640Contacts';
import { apiFetch, readData } from '../../../coach/apiClient';
import type { ContactFilters } from './contactsFilters';

const BASE = '/api/v1/candidate/b640/contacts';
export const CONTACTS_PAGE = 20;

export interface ContactsQuery {
  readonly search: string;
  readonly filters: ContactFilters;
  readonly sort: B640ContactSort;
  readonly offset: number;
}

export type { B640Contact, B640ContactList };

/** Строка запроса: повторяющиеся `company`, `link`, `status`; пустое не пишем. */
export function contactsQueryString(query: ContactsQuery): string {
  const params = new URLSearchParams({ limit: String(CONTACTS_PAGE), offset: String(query.offset), sort: query.sort });
  const search = query.search.trim();
  if (search) params.set('search', search);
  query.filters.company.forEach((name) => params.append('company', name));
  query.filters.link.forEach((value) => params.append('link', value));
  query.filters.status.forEach((value) => params.append('status', value));
  return params.toString();
}

export async function listB640Contacts(query: ContactsQuery): Promise<B640ContactList> {
  const response = await apiFetch(`${BASE}?${contactsQueryString(query)}`, { method: 'GET' });
  return readData<B640ContactList>(response);
}

export async function setB640ContactStatus(contactId: string, state: B640ContactState): Promise<B640ContactStatusResult> {
  const response = await apiFetch(`${BASE}/${encodeURIComponent(contactId)}/status`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ state }),
  });
  return readData<B640ContactStatusResult>(response);
}
