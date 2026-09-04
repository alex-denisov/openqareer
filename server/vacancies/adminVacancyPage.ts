import type { UnifiedVacancy } from '../domain/unifiedVacancy';

/**
 * Список вакансий админ-консоли отдаётся страницами, помещающимися в один ответ.
 *
 * Прод обрывал `GET /api/v1/admin/vacancies` ровно на 20 220 байтах и делал это
 * при любом `limit`: JSON приходил невалидным, и консоль не показывала ни одной
 * страницы пула (INC-032). Тот же байтовый порог уже разобран на подборе
 * (INC-029) и на снимке кандидата (INC-030), и лечится он одинаково — страницей
 * внутри доказанного бюджета 12 288 байт, того самого, которым релизная сборка
 * режет ассеты.
 *
 * Бюджет выбирался на пяти записях потому, что список вёз весь текст поста:
 * `fullDescription`, обязанности, требования, бенефиты, «о компании». Списку
 * это не нужно — карточка печатает должность, работодателя, локацию, зарплату,
 * источник, дату и до шести навыков. Полную запись отдаёт отдельный маршрут
 * `GET /api/v1/admin/vacancies/:vacancyId`, который открывает модальное окно.
 */
export const ADMIN_VACANCY_PAGE_BYTE_BUDGET = 12_288;

/** Столько навыков печатает карточка списка. */
const VISIBLE_SKILLS = 6;

/** Столько символов описания видно в карточке до модального окна. */
const SNIPPET_CHARS = 180;

export interface AdminVacancyListItem {
  readonly id: string;
  readonly fingerprint: string;
  readonly title: string;
  readonly company: string;
  readonly location?: string;
  readonly isRemote?: boolean;
  readonly salary?: UnifiedVacancy['salary'];
  /** Начало описания: карточка всё равно показывает не больше двух строк. */
  readonly descriptionSnippet: string;
  readonly requiredSkills: readonly string[];
  /** Сколько навыков у записи на самом деле — счёт вместо списка. */
  readonly skillCount: number;
  readonly employmentType?: string;
  readonly experienceLevel?: string;
  readonly postType?: UnifiedVacancy['postType'];
  readonly url: string;
  readonly provenance: UnifiedVacancy['provenance'];
  readonly publishedAt: string;
  readonly status: UnifiedVacancy['status'];
}

export interface AdminVacancyPage {
  readonly items: AdminVacancyListItem[];
  readonly total: number;
  readonly offset: number;
  /** Смещение следующей страницы; `null` — выборка кончилась. */
  readonly nextOffset: number | null;
}

function snippet(description: string): string {
  const clean = description.replace(/\s+/gu, ' ').trim();
  return clean.length <= SNIPPET_CHARS ? clean : `${clean.slice(0, SNIPPET_CHARS)}…`;
}

export function summarizeAdminVacancy(vacancy: UnifiedVacancy): AdminVacancyListItem {
  return {
    id: vacancy.id,
    fingerprint: vacancy.fingerprint,
    title: vacancy.title,
    company: vacancy.company,
    ...(vacancy.location === undefined ? {} : { location: vacancy.location }),
    ...(vacancy.isRemote === undefined ? {} : { isRemote: vacancy.isRemote }),
    ...(vacancy.salary === undefined ? {} : { salary: vacancy.salary }),
    descriptionSnippet: snippet(vacancy.description),
    requiredSkills: vacancy.requiredSkills.slice(0, VISIBLE_SKILLS),
    skillCount: vacancy.requiredSkills.length,
    ...(vacancy.employmentType === undefined ? {} : { employmentType: vacancy.employmentType }),
    ...(vacancy.experienceLevel === undefined ? {} : { experienceLevel: vacancy.experienceLevel }),
    ...(vacancy.postType === undefined ? {} : { postType: vacancy.postType }),
    url: vacancy.url,
    provenance: vacancy.provenance,
    publishedAt: vacancy.publishedAt,
    status: vacancy.status,
  };
}

export function buildAdminVacancyPage(
  all: readonly UnifiedVacancy[],
  offset: number,
  /** Запрошенный `limit`: он только сужает страницу, расширить бюджет он не может. */
  maxItems: number = Number.MAX_SAFE_INTEGER,
  budgetBytes: number = ADMIN_VACANCY_PAGE_BYTE_BUDGET,
): AdminVacancyPage {
  const start = Math.max(0, Math.trunc(offset));
  const items: AdminVacancyListItem[] = [];
  // Открывающая и закрывающая скобки массива входят в тот же бюджет.
  let size = 2;

  for (let index = start; index < all.length; index += 1) {
    if (items.length >= maxItems) break;
    const item = summarizeAdminVacancy(all[index]);
    const cost = Buffer.byteLength(JSON.stringify(item), 'utf8') + (items.length > 0 ? 1 : 0);
    // Запись, которая одна не влезает в бюджет, всё равно уходит первой: иначе
    // страница вернулась бы пустой и выборка выглядела бы кончившейся.
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
