export type When =
  { readonly ok: true; readonly iso: string } | { readonly ok: false; readonly error: string };

const FORMAT_ERROR = 'Дата и время в виде 12.11.2026 15:00';
const WHEN_RE = /^(\d{1,2})\.(\d{1,2})\.(\d{4}),?\s+(\d{1,2}):(\d{2})$/u;

/** «Когда интервью?»: «дд.мм.гггг чч:мм» по местному времени кандидата; прошедшая дата — ошибка. */
export function parseWhen(value: string, now: Date): When {
  const text = value.trim();
  if (!text) return { ok: false, error: 'Укажите дату и время' };
  const match = WHEN_RE.exec(text);
  if (!match) return { ok: false, error: FORMAT_ERROR };
  const [day, month, year, hour, minute] = match.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
  ];
  const date = new Date(year, month - 1, day, hour, minute);
  const exact =
    date.getDate() === day &&
    date.getMonth() === month - 1 &&
    date.getHours() === hour &&
    minute < 60;
  if (!exact) return { ok: false, error: FORMAT_ERROR };
  if (date.getTime() < now.getTime()) return { ok: false, error: 'Эта дата уже прошла' };
  return { ok: true, iso: date.toISOString() };
}
