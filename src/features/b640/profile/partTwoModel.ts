import { pluralRu } from '../../../../shared/pluralRu';
import type { CandidateConnectionContact } from '../../outreach/connectionContactsApi';
import type { ResumeDraft } from '../../resume/resumeTypes';

export interface ProfileQuestion {
  readonly entryId: string;
  readonly employer: string;
  readonly text: string;
}

/**
 * Один вопрос о профиле: размер команды у первого места работы, где он не
 * указан. Отдельного списка вопросов на сервере нет — вопрос выводим из профиля.
 */
export function nextQuestion(draft: ResumeDraft): ProfileQuestion | null {
  const entry = draft.experience.find((item) => !item.teamSize);
  if (!entry) return null;
  const employer = entry.employer?.trim() ?? '';
  const place = employer
    ? `в «${employer}»`
    : `на месте «${entry.title?.trim() || 'без названия'}»`;
  return { entryId: entry.id, employer, text: `Сколько человек было в команде ${place}?` };
}

/** Сколько вопросов о профиле осталось: по месту работы без размера команды. */
export function questionCount(draft: ResumeDraft): number {
  return draft.experience.filter((item) => !item.teamSize).length;
}

const MAX_TEAM_SIZE = 100_000;

/** Размер команды из ответа; `null` — ответ не число. */
export function teamAnswer(text: string): number | null {
  const value = text.trim();
  if (!/^\d+$/u.test(value)) return null;
  const size = Number(value);
  return size >= 1 && size <= MAX_TEAM_SIZE ? size : null;
}

export interface ContactPerson {
  readonly id: string;
  readonly name: string;
  readonly role: string;
}

export interface ContactGroup {
  readonly company: string;
  readonly people: readonly ContactPerson[];
}

const NO_COMPANY = 'Компания не указана';

/** Связи по компаниям в порядке появления; поиск — по имени и компании. */
export function contactGroups(
  contacts: readonly CandidateConnectionContact[],
  query: string,
): ContactGroup[] {
  const needle = query.trim().toLocaleLowerCase('ru');
  const groups = new Map<string, ContactPerson[]>();
  for (const contact of contacts) {
    const company = contact.companyName?.trim() || NO_COMPANY;
    const haystack = `${contact.fullName} ${company}`.toLocaleLowerCase('ru');
    if (needle && !haystack.includes(needle)) continue;
    const person = {
      id: contact.id,
      name: contact.fullName,
      role: contact.roleTitle?.trim() ?? '',
    };
    groups.set(company, [...(groups.get(company) ?? []), person]);
  }
  return [...groups].map(([company, people]) => ({ company, people }));
}

export function contactsHeading(total: number): string {
  return total > 0 ? pluralRu(total, ['связь', 'связи', 'связей']) : 'Связей пока нет';
}
