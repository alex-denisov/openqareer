import type { CandidateConnectionContact } from '../../../outreach/connectionContactsApi';
import { pluralRu } from '../../vacancies/format';

const COUNT = new Intl.NumberFormat('ru-RU');

export const formatCount = (count: number): string => COUNT.format(count);

/** «1 500 контактов» — заголовок списка. */
export const contactsTitle = (count: number): string =>
  `${formatCount(count)} ${pluralRu(count, 'контакт', 'контакта', 'контактов')}`;

/** «руководитель найма · Гринкод»; пустые части не выводим. */
export function workLine(contact: CandidateConnectionContact): string {
  return [contact.roleTitle, contact.companyName].map((part) => part.trim()).filter(Boolean).join(' · ');
}

/** Дописывает новую порцию, не дублируя уже загруженных людей. */
export function appendContacts(
  before: readonly CandidateConnectionContact[],
  next: readonly CandidateConnectionContact[],
): readonly CandidateConnectionContact[] {
  const known = new Set(before.map((contact) => contact.id));
  return [...before, ...next.filter((contact) => !known.has(contact.id))];
}

/** Дата сбора для ⓘ: «10 ноября»; чужая строка — пусто. */
export function importedOn(iso: string | null): string {
  const time = iso ? Date.parse(iso) : Number.NaN;
  if (!Number.isFinite(time)) return '';
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }).format(new Date(time));
}
