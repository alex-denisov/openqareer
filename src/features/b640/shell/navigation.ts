import type { IconName } from '../kit/Icon';
import { buildNodePath, type B640Nav } from '../routes';

export interface NavItem {
  readonly id: B640Nav;
  readonly label: string;
  readonly icon: IconName;
  readonly path: string;
  /** Полное имя для чтения с экрана, если подпись короче. */
  readonly ariaLabel?: string;
}

const item = (
  id: B640Nav,
  label: string,
  icon: IconName,
  code: string,
  ariaLabel?: string,
): NavItem => ({ id, label, icon, path: buildNodePath(code), ...(ariaLabel ? { ariaLabel } : {}) });

/** Рейл 1440 и 1176: шесть разделов по ходу работы. */
export const RAIL_ITEMS: readonly NavItem[] = [
  item('today', 'Сегодня', 'today', 's03'),
  item('profile', 'Профиль', 'profile', 's01'),
  item('career', 'Карьера', 'career', 's09'),
  item('vacancies', 'Вакансии', 'vacancies', 's07'),
  item('responses', 'Отклики', 'responses', 'o01'),
  item('diary', 'Дневник', 'diary', 'd00', 'Карьерный дневник'),
];

export const RAIL_ACCOUNT: NavItem = item('settings', 'Аккаунт', 'settings', 'n03');

/** Нижняя навигация 390: четыре раздела и «Ещё». */
export const BOTTOM_ITEMS: readonly NavItem[] = RAIL_ITEMS.filter((entry) =>
  ['today', 'profile', 'vacancies', 'responses'].includes(entry.id),
);

/** Меню «Ещё» на 390. */
export const MORE_ITEMS: readonly NavItem[] = [
  item('career', 'Карьера', 'career', 's09'),
  item('diary', 'Карьерный дневник', 'diary', 'd00'),
  item('bell', 'Уведомления', 'bell', 'n01b'),
  item('tariffs', 'Тарифы', 'wallet', 't01'),
  item('settings', 'Аккаунт', 'user', 'n00'),
];

export const NOTIFICATIONS_PATH = buildNodePath('n01b');
export const TARIFFS_PATH = buildNodePath('t01');
export const CONSULTANT_PATH = buildNodePath('k01');

/** «Назад к …»: раздел в дательном падеже; для прочих звеньев — «Назад: подпись». */
const DATIVE: Readonly<Record<string, string>> = {
  Отклики: 'откликам',
  Профиль: 'профилю',
  Вакансии: 'вакансиям',
  Карьера: 'карьере',
  Аккаунт: 'аккаунту',
  Консультант: 'консультанту',
  Дневник: 'дневнику',
  'Цифровой след': 'цифровому следу',
};

export function backLabel(label: string): string {
  return DATIVE[label] ? `Назад к ${DATIVE[label]}` : `Назад: ${label}`;
}
