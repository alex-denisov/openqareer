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

/** Атрибуты корня страницы: узел адреса и, если показан вариант, его код. */
export function pageAttrs(node: B640Node, state?: string): Record<string, string> {
  return {
    'data-b640-node': node.code,
    'data-b640-section': node.section,
    ...(state ? { 'data-b640-state': state } : {}),
  };
}
