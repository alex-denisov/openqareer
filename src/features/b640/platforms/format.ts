const WHEN = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
const DAY = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' });

/** «10 ноября, 16:05»; пусто, если дата не читается. */
export function formatWhen(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : WHEN.format(date);
}

/** «10 ноября»; пусто, если дата не читается. */
export function formatDay(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : DAY.format(date);
}
