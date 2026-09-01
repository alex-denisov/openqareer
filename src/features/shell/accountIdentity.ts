/**
 * Инициалы для аватара.
 *
 * Один человек — один объект в интерфейсе: аватар в рельсе и аватар в панели
 * аккаунта обязаны выглядеть одинаково, иначе кандидат видит два разных
 * представления себя. Буква никогда не берётся из почты, которую кандидат не
 * подтверждал: без имени рисуется нейтральный знак.
 */
export function initialsFor(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/u).filter(Boolean);
  if (parts.length === 0) return '—';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toLocaleUpperCase('ru-RU');
  return `${parts[0]![0]!}${parts[1]![0]!}`.toLocaleUpperCase('ru-RU');
}
