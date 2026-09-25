/**
 * The plans, in one place, because the rail's plan card and the tariffs screen
 * must never disagree about what the candidate is on. Payment is not connected,
 * so `CURRENT_PLAN` is the plan that actually works today — naming any other
 * one in the rail would be a claim the product cannot back.
 */
export const tariffPackages = [
  {
    id: 'free',
    name: 'Самостоятельно',
    price: '0 ₽',
    time: 'без срока',
    status: 'Доступно сейчас',
    points: [
      'Профиль по фактам',
      'Выбор роли и условий',
      'Вакансии из источников',
      'Один следующий шаг',
    ],
    note: 'Работает сейчас без оплаты: доказательства, гипотезы, рыночная проверка и первое действие остаются у кандидата.',
  },
  {
    id: 'setup',
    name: 'С консультантом',
    price: 'от 4 900 ₽',
    time: '30 дней',
    status: 'Ручное сопровождение',
    points: ['Разбор профиля и ролей', 'Уточнение условий поиска', 'План первых недель'],
    note: 'Ориентир за объём и срок ручной сопровождаемой работы, не за обещание интервью или оффера. Оплата ещё не подключена.',
  },
  {
    id: 'auto',
    name: 'Автоматизация',
    price: 'Цена не определена',
    time: 'пока недоступно',
    status: 'Автоматизация пока недоступна',
    points: ['Поиск и приоритизация', 'Отклики и аутрич', 'Ответы и интервью'],
    note: 'Автоматизация откликов появится после проверки безопасности на реальных аккаунтах.',
  },
] as const;

export type TariffPackage = (typeof tariffPackages)[number];

/** What every candidate is on until payment exists. */
export const CURRENT_PLAN: TariffPackage = tariffPackages[0];
