import { buildNodePath, type B640Node } from '../routes';

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

/**
 * «Вакансии по роли «X»» (B726): «Подборка» открывается с этой ролью в фильтре «Роли» —
 * тем же фильтром по названию роли, что выбирает кандидат.
 */
export function roleVacanciesPath(role: string): string {
  return `${buildNodePath('s07')}?${new URLSearchParams({ [ROLE_PARAM]: role })}`;
}

/** Роль из адреса «Подборки»; нет или пустая — `null`. */
export function linkedRole(search: string): string | null {
  return new URLSearchParams(search).get(ROLE_PARAM)?.trim() || null;
}

/** Атрибуты корня страницы: узел адреса и, если показан вариант, его код. */
export function pageAttrs(node: B640Node, state?: string): Record<string, string> {
  return {
    'data-b640-node': node.code,
    'data-b640-section': node.section,
    ...(state ? { 'data-b640-state': state } : {}),
  };
}
