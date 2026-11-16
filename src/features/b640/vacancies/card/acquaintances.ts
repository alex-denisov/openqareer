import type { VacancyConnectionCircles } from '../../../vacancies/vacancyLetterApi';

export interface Acquaintance {
  readonly key: string;
  readonly name: string;
  readonly sub: string;
}

export const PLATFORM_MEMBER = 'Участник платформы';

/**
 * Знакомые в компании по кругам. Участник платформы приходит одной строкой без имени и ссылки:
 * его данные из ответа не читаются вовсе.
 */
export function acquaintancesOf(data: VacancyConnectionCircles | undefined): readonly Acquaintance[] {
  if (!data) return [];
  const seen = new Set<string>();
  return data.circles.flatMap((result) => {
    const people = result.paths
      .filter((path) => path.source !== 'cold' && !seen.has(path.recipient.id))
      .map((path) => {
        seen.add(path.recipient.id);
        const parts = [path.recipient.roleTitle, `${path.circle}-й круг`].filter(Boolean);
        return { key: path.recipient.id, name: path.recipient.fullName, sub: parts.join(' · ') };
      });
    const members = Array.from({ length: result.platformMembers?.count ?? 0 }, (_, index) => ({
      key: `platform-${index}`,
      name: PLATFORM_MEMBER,
      sub: `${result.circle}-й круг`,
    }));
    return [...people, ...members];
  });
}
