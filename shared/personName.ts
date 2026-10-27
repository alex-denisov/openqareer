/**
 * Имя человека из заголовка поисковой выдачи: «Имя Фамилия - Должность at
 * Компания | LinkedIn» → «Имя Фамилия». Должность в имени ломает поиск
 * каналов по имени и выглядит для кандидата ошибкой.
 */
export function personNameFromTitle(title: string): string {
  const [head = ''] = title.split(/\s+[-–—|·]\s+|,\s+|\s+\(/u);
  return head.trim().replace(/\s+/gu, ' ');
}
