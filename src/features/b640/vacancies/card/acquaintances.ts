import type { B640CompanyPerson } from '../../../../../shared/b640Companies';

export interface Acquaintance {
  readonly key: string;
  readonly name: string;
  readonly sub: string;
}

export const PLATFORM_MEMBER = 'Участник сети';

/** «1-й круг · путь»: круг и то, почему этот человек (общая работа, общий знакомый). */
export function pathLine(person: B640CompanyPerson): string {
  return [`${person.circle}-й круг`, person.evidence].filter(Boolean).join(' · ');
}

/** Первый знакомый 1-го круга с именем: через него рекомендуется отклик. */
export function friendOf(people: readonly B640CompanyPerson[]): B640CompanyPerson | undefined {
  return people.find(
    (person) => person.circle === 1 && !person.platformMember && Boolean(person.name?.trim()),
  );
}

/**
 * Знакомые в компании: круги 1 и 2. Круг 3 — холодный отклик, не знакомый.
 * Участник платформы приходит без имени и ссылки: показываем «Участник сети», должность и путь.
 */
export function acquaintancesOf(
  people: readonly B640CompanyPerson[] | undefined,
): readonly Acquaintance[] {
  return (people ?? [])
    .filter((person) => person.circle !== 3)
    .map((person) => {
      const role = person.roleTitle;
      return {
        key: person.id,
        name: person.platformMember ? PLATFORM_MEMBER : (person.name ?? 'Без имени'),
        sub: [role, pathLine(person)].filter(Boolean).join(' · '),
      };
    });
}

const DATIVE_ENDINGS: readonly (readonly [RegExp, string])[] = [
  [/ия$/u, 'ии'],
  [/[ая]$/u, 'е'],
  [/[йь]$/u, 'ю'],
  [/[бвгджзклмнпрстфхцчшщ]$/u, '$&у'],
];

/** «Роман Ефимов» → «Роману»; имя не по-русски или неясное — без склонения. */
export function writeLabel(name: string | null | undefined): string {
  const first = (name ?? '').trim().split(/\s+/u)[0] ?? '';
  if (!/^[А-Яа-яЁё-]+$/u.test(first)) return 'Написать знакомому';
  const rule = DATIVE_ENDINGS.find(([pattern]) => pattern.test(first));
  return rule ? `Написать ${first.replace(rule[0], rule[1])}` : 'Написать знакомому';
}
