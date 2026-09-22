import { ADMIN_VACANCY_PAGE_BYTE_BUDGET } from './adminVacancyPage';

/**
 * Список площадок админ-консоли отдаётся страницами внутри того же доказанного
 * бюджета, что и список вакансий.
 *
 * Здоровье площадок (B200) раздуло `GET /api/v1/admin/vacancy-sources` с 12 до
 * 29 788 байт, и прод оборвал тело на 20 220 байтах — том самом пороге, на
 * котором уже рвались подбор (INC-029), снимок кандидата (INC-030) и список
 * вакансий (INC-032). JSON приходил невалидным, и экран источников показывал
 * пустоту вместо двадцати семи карточек.
 *
 * Лечится это одинаково во всех четырёх случаях: страницей внутри 12 288 байт,
 * того самого бюджета, которым релизная сборка режет ассеты.
 */
export interface AdminSourcePage<T> {
  readonly items: readonly T[];
  readonly total: number;
  readonly offset: number;
  /** Смещение следующей страницы; `null` — выборка кончилась. */
  readonly nextOffset: number | null;
}

export function buildAdminSourcePage<T, R = T>(
  all: readonly T[],
  offset: number,
  budgetBytes: number = ADMIN_VACANCY_PAGE_BYTE_BUDGET,
  transform?: (item: T) => R,
): AdminSourcePage<R> {
  const start = Math.max(0, Math.trunc(offset));
  const items: R[] = [];
  // Открывающая и закрывающая скобки массива входят в тот же бюджет.
  let size = 2;

  for (let index = start; index < all.length; index += 1) {
    const item = transform ? transform(all[index]) : (all[index] as unknown as R);
    const cost = Buffer.byteLength(JSON.stringify(item), 'utf8') + (items.length > 0 ? 1 : 0);
    // Запись, которая одна не влезает в бюджет, всё равно уходит первой: иначе
    // страница вернулась бы пустой, выборка выглядела бы кончившейся, и
    // площадка исчезла бы с экрана совсем.
    if (items.length > 0 && size + cost > budgetBytes) break;
    items.push(item);
    size += cost;
  }

  const nextOffset = start + items.length;
  return {
    items,
    total: all.length,
    offset: start,
    nextOffset: nextOffset < all.length ? nextOffset : null,
  };
}
