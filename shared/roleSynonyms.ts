/**
 * Мост между тем, как одну и ту же роль называют по-русски и по-английски.
 *
 * Пул собирается из русскоязычных и международных источников, поэтому
 * «Продакт-менеджер» и «Senior Product Manager» — это одна роль, а не две
 * выборки по половине. Без склейки обе оказывались ниже порога наблюдений и
 * ни одна не становилась гипотезой (B180, срез 1).
 *
 * Таблица поддерживается руками и намеренно маленькая: список ролей продукта
 * растёт вместе с источниками, а склейка «по смыслу» без списка — это уже
 * догадка о рынке, которую нечем проверить.
 */
export const ROLE_WORD_SYNONYMS: Readonly<Record<string, string>> = {
  продакт: 'product',
  продуктовый: 'product',
  продуктовая: 'product',
  продукта: 'product',
  менеджер: 'manager',
  менеджеров: 'manager',
  управляющий: 'manager',
  аналитик: 'analyst',
  аналитика: 'analyst',
  разработчик: 'developer',
  разработчика: 'developer',
  программист: 'developer',
  инженер: 'engineer',
  инженера: 'engineer',
  дизайнер: 'designer',
  дизайнера: 'designer',
  маркетолог: 'marketer',
  тестировщик: 'qa',
  тестирования: 'qa',
  директор: 'director',
  руководитель: 'head',
  начальник: 'head',
  архитектор: 'architect',
  консультант: 'consultant',
  рекрутер: 'recruiter',
  бухгалтер: 'accountant',
  юрист: 'lawyer',
  водитель: 'driver',
  повар: 'cook',
  продавец: 'salesperson',
  оператор: 'operator',
  логист: 'logistician',
  фронтенд: 'frontend',
  бэкенд: 'backend',
  фулстек: 'fullstack',
};

export function canonicalRoleWord(word: string): string {
  return ROLE_WORD_SYNONYMS[word] ?? word;
}
