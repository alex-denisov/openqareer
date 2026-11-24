import type { B640Connection } from '../../../../shared/b640Connections';
import { pluralRu, pluralWordRu } from '../../../../shared/pluralRu';

export interface ConnectionGroup {
  readonly company: string;
  readonly inSelection: boolean;
  readonly people: readonly B640Connection[];
}

const NO_COMPANY = 'Компания не указана';

/** Связи по компаниям в порядке сервера; компания, разбитая порциями, — одна группа. */
export function connectionGroups(items: readonly B640Connection[]): ConnectionGroup[] {
  const groups = new Map<string, ConnectionGroup>();
  for (const item of items) {
    const company = item.companyName || NO_COMPANY;
    const people = groups.get(company)?.people ?? [];
    groups.set(company, { company, inSelection: item.inSelection, people: [...people, item] });
  }
  return [...groups.values()];
}

/** «руководитель группы · ваша связь»; у 2-го круга — кто может представить. */
export function connectionNote(person: B640Connection): string {
  const path = person.via ? `общий знакомый: ${person.via}` : 'ваша связь';
  return [person.roleTitle, path].filter(Boolean).join(' · ');
}

export interface ConnectionsHeading {
  readonly full: string;
  readonly short: string;
}

/** Счёт компаний подборки; пока их нет или подборка считается — счёт связей. */
export function connectionsHeading(connections: number, companies: number): ConnectionsHeading {
  if (companies > 0) {
    const where = `${companies} ${pluralWordRu(companies, ['компании', 'компаниях', 'компаниях'])}`;
    return { full: `Знакомые есть в ${where} из подборки`, short: `Знакомые в ${where}` };
  }
  const text =
    connections > 0 ? pluralRu(connections, ['связь', 'связи', 'связей']) : 'Связей пока нет';
  return { full: text, short: text };
}

export function appendConnections(
  before: readonly B640Connection[],
  next: readonly B640Connection[],
): readonly B640Connection[] {
  const known = new Set(before.map((item) => item.id));
  return [...before, ...next.filter((item) => !known.has(item.id))];
}
