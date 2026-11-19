import type { B640Contact } from '../../../../../shared/b640Contacts';
import { pluralRu } from '../../vacancies/format';

const COUNT = new Intl.NumberFormat('ru-RU');

export const formatCount = (count: number): string => COUNT.format(count);

/** «1 500 контактов» — заголовок списка. */
export const contactsTitle = (count: number): string =>
  `${formatCount(count)} ${contactsWord(count)}`;

/** Слово после числа: «контактов», «контакт», «контакта». */
export const contactsWord = (count: number): string => pluralRu(count, 'контакт', 'контакта', 'контактов');

/** «руководитель найма · Гринкод»; пустые части не выводим. */
export function workLine(contact: Pick<B640Contact, 'roleTitle' | 'companyName'>): string {
  return [contact.roleTitle, contact.companyName].map((part) => part.trim()).filter(Boolean).join(' · ');
}

/** Дописывает новую порцию, не дублируя уже загруженных людей. */
export function appendContacts(before: readonly B640Contact[], next: readonly B640Contact[]): readonly B640Contact[] {
  const known = new Set(before.map((contact) => contact.id));
  return [...before, ...next.filter((contact) => !known.has(contact.id))];
}

/** Дата сбора для ⓘ: «10 ноября»; чужая строка — пусто. */
export function importedOn(iso: string | null): string {
  const time = iso ? Date.parse(iso) : Number.NaN;
  if (!Number.isFinite(time)) return '';
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }).format(new Date(time));
}
