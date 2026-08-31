/**
 * The plans, in one place, because the rail's plan card and the tariffs screen
 * must never disagree about what the candidate is on. Payment is not connected,
 * so `CURRENT_PLAN` is the plan that actually works today — naming any other
 * one in the rail would be a claim the product cannot back.
 */
export const tariffPackages = [
  {
    id: 'free',
    name: 'Диагностика',
    price: '0 ₽',
    time: 'без срока',
    status: 'Доступно сейчас',
    points: ['Карьерная картина', 'Гипотезы ролей', 'Первое действие'],
    note:
      'Работает сейчас без оплаты: доказательства, гипотезы, рыночная проверка и первое действие остаются у кандидата.',
  },
  {
    id: 'setup',
    name: 'Настройка поиска',
    price: 'от 4 900 ₽',
    time: '30 дней',
    status: 'Ручное сопровождение',
    points: ['Материалы под роль', 'Целевые компании', 'Старт кампании'],
    note:
      'Ориентир за объём и срок ручной сопровождаемой работы, не за обещание интервью или оффера. Оплата ещё не подключена.',
  },
  {
    id: 'auto',
    name: 'Автопилот',
    price: 'Цена не определена',
    time: 'после проверки адаптеров',
    status: 'Автопилот пока недоступен',
    points: [
      'Поиск и приоритизация',
      'Отклики и outreach',
      'Ответы и интервью',
    ],
    note:
      'Автоматизация внешних аккаунтов не продаётся до проверки выделенных test-account, receipts, лимитов и аварийного отключения.',
  },
] as const;

export type TariffPackage = (typeof tariffPackages)[number];

/** What every candidate is on until payment exists. */
export const CURRENT_PLAN: TariffPackage = tariffPackages[0];
