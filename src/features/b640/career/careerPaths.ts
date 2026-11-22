import { buildNodePath, type B640Node } from '../routes';
import { DATE_OPTIONS, type DateId } from '../vacancies/list/filterModel';

const CONDITIONS_VIEW = 'conditions';

/**
 * C10 «Условия и география» — состояние S9 без своего узла карты: открывается
 * параметром адреса. Ссылка «Зарплата от — в условиях поиска» из «Вакансий» ведёт сюда.
 */
export function conditionsPath(): string {
  return `${buildNodePath('s09')}?view=${CONDITIONS_VIEW}`;
}

export function isConditionsView(search: string): boolean {
  return new URLSearchParams(search).get('view') === CONDITIONS_VIEW;
}

const ROLE_PARAM = 'role';
const DATE_PARAM = 'date';
/** Окно числа роли «по подборке за 30 дней» — то же значение фильтра «Дата». */
const ROLE_WINDOW_DATE: DateId = '30';

/**
 * «Вакансии по роли «X»» (B726): «Подборка» открывается с этой ролью в фильтре «Роли» и
 * «Дата: 30 дней» — теми же строками, по которым «Карьера» посчитала число роли.
 */
export function roleVacanciesPath(role: string): string {
  const query = new URLSearchParams({ [ROLE_PARAM]: role, [DATE_PARAM]: ROLE_WINDOW_DATE });
  return `${buildNodePath('s07')}?${query}`;
}

/** Роль из адреса «Подборки»; нет или пустая — `null`. */
export function linkedRole(search: string): string | null {
  return new URLSearchParams(search).get(ROLE_PARAM)?.trim() || null;
}

/** «Дата» из адреса «Подборки» — только период фильтра «Дата»; иначе `null`. */
export function linkedDate(search: string): DateId | null {
  const value = new URLSearchParams(search).get(DATE_PARAM);
  const option = DATE_OPTIONS.find((entry) => entry.id === value && entry.days !== undefined);
  return option?.id ?? null;
}

/** Атрибуты корня страницы: узел адреса и, если показан вариант, его код. */
export function pageAttrs(node: B640Node, state?: string): Record<string, string> {
  return {
    'data-b640-node': node.code,
    'data-b640-section': node.section,
    ...(state ? { 'data-b640-state': state } : {}),
  };
}
