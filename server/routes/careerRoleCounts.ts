import type { ProposedRole } from '../../shared/roleProposals';
import type { MatchedVacancyItem } from '../vacancies/multiSourceVacancyEngine';
import { confirmChosenTitle } from '../vacancies/roleHypotheses';
import { isValidTimezone } from '../../shared/timezoneUtils';

/** Окно подписи «по подборке за 30 дней» в «Карьере» (макет s09) и фильтра «Дата: 30 дней». */
export const CAREER_ROLE_WINDOW_DAYS = 30;
const DAY_MS = 86_400_000;

/** Пояс кандидата из запроса (`?tz=`), как у «Сегодня»: только IANA, иначе UTC. */
export function careerTimeZone(query: unknown): string {
  const tz = (query as { readonly tz?: unknown } | undefined)?.tz;
  return typeof tz === 'string' && isValidTimezone(tz) ? tz.trim() : 'UTC';
}

/** Сдвиг стенных часов пояса от UTC в момент `at`, в миллисекундах. */
function zoneOffsetMs(at: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(at));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((entry) => entry.type === type)?.value ?? 0);
  const wall = Date.UTC(
    part('year'),
    part('month') - 1,
    part('day'),
    part('hour'),
    part('minute'),
    part('second'),
  );
  return wall - Math.floor(at / 1000) * 1000;
}

/** Полночь сегодняшнего дня кандидата в его поясе — момент UTC в миллисекундах. */
export function startOfDayIn(now: Date, timeZone: string): number {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone }).format(now);
  const midnight = Date.parse(`${day}T00:00:00Z`);
  // Второй шаг — на случай перевода часов между полуночью UTC и полуночью пояса.
  return midnight - zoneOffsetMs(midnight - zoneOffsetMs(midnight, timeZone), timeZone);
}

/**
 * Та же дата и та же граница, что у фильтра «Дата» в «Подборке»: первый источник или первое
 * появление, от начала сегодняшнего дня кандидата назад на `days` дней. B702-2: граница одна на
 * список — три форматтера Intl на строку держали event loop 1,2 с (прод 24.11).
 */
export function withinLastDays(
  items: readonly MatchedVacancyItem[],
  days: number,
  now: Date,
  timeZone = 'UTC',
): MatchedVacancyItem[] {
  const since = startOfDayIn(now, timeZone) - days * DAY_MS;
  // Строка без даты даёт NaN и ни в одно окно не входит.
  return items.filter(
    ({ cluster }) => Date.parse(cluster.sources[0]?.observedAt ?? cluster.firstObservedAt) >= since,
  );
}

/**
 * Число и данные роли «Карьеры» (B726) — по тем же строкам, что откроет «Вакансии по роли»:
 * список «Подборки» после её фильтров и ворот уровня, тот же признак роли, что у фильтра
 * «Роли», за 30 дней. Иначе кандидат видит 174 в «Карьере» и 267 после перехода.
 */
export function countRolesLikeTheList(
  roles: readonly ProposedRole[],
  listed: readonly MatchedVacancyItem[],
  options: {
    readonly skills: readonly string[];
    readonly now: Date;
    readonly timeZone?: string;
  },
): ProposedRole[] {
  const recent = withinLastDays(listed, CAREER_ROLE_WINDOW_DAYS, options.now, options.timeZone);
  return roles.map((role) => ({
    ...role,
    confirmation: confirmChosenTitle({
      matched: recent,
      title: role.title,
      candidateSkills: options.skills,
    }),
  }));
}
