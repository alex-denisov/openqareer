const WHEN = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'long',
  hour: '2-digit',
  minute: '2-digit',
});
const DAY = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' });

/** «10 ноября, 16:05»; пусто, если дата не читается. */
export function formatWhen(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const parts = WHEN.formatToParts(date);
  const pick = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  return `${pick('day')} ${pick('month')}, ${pick('hour')}:${pick('minute')}`;
}

/** «10 ноября»; пусто, если дата не читается. */
export function formatDay(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : DAY.format(date);
}

const slotFormat = (weekday: 'short' | 'long') =>
  new Intl.DateTimeFormat('ru-RU', {
    weekday,
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  });
const SLOT = slotFormat('short');
const SLOT_LONG = slotFormat('long');
const ON_WEEKDAY: Readonly<Record<string, string>> = {
  понедельник: 'в понедельник',
  вторник: 'во вторник',
  среда: 'в среду',
  четверг: 'в четверг',
  пятница: 'в пятницу',
  суббота: 'в субботу',
  воскресенье: 'в воскресенье',
};

/** «ср, 18 ноября, 10:00»: части собираем сами, чтобы не было «в» перед временем. */
function slotText(format: Intl.DateTimeFormat, iso: string | null | undefined, onWeekday = false) {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const part = (type: string) =>
    format.formatToParts(date).find((item) => item.type === type)?.value ?? '';
  const weekday = onWeekday ? (ON_WEEKDAY[part('weekday')] ?? part('weekday')) : part('weekday');
  return `${weekday}, ${part('day')} ${part('month')}, ${part('hour')}:${part('minute')}`;
}

/** «пт, 13 ноября, 10:00»; пусто, если дата не читается. */
export const formatSlot = (iso: string | null | undefined) => slotText(SLOT, iso);

/** «пятница, 13 ноября, 10:00»; пусто, если дата не читается. */
export const formatSlotLong = (iso: string | null | undefined) => slotText(SLOT_LONG, iso);

/** «в пятницу, 13 ноября, 10:00»: для «Опубликуем …». */
export const formatSlotOn = (iso: string | null | undefined) => slotText(SLOT_LONG, iso, true);
