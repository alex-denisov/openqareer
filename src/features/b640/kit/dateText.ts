/**
 * B733: дата в кабинете набирается как «дд.мм.гггг», а в API уходит ISO «гггг-мм-дд».
 * Нативное поле даты берёт формат из региона системы (в .app с английским регионом —
 * «мм/дд/гггг»), поэтому поле текстовое и разбирается здесь.
 */

export const DATE_FORMAT_ERROR = 'Дата в виде дд.мм.гггг';

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const RU_DAY = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/;

export interface ReadDate {
  /** ISO-день или `''`, если поле пустое либо дата не читается. */
  readonly iso: string;
  readonly error?: string;
}

export function isoToRuDate(iso: string): string {
  const match = ISO_DAY.exec(iso);
  return match ? `${match[3]}.${match[2]}.${match[1]}` : '';
}

function toIso(day: number, month: number, year: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  const real =
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  return real ? date.toISOString().slice(0, 10) : null;
}

/** `max` — ISO-день, позже которого дата не принимается. */
export function readRuDate(text: string, max?: string): ReadDate {
  const clean = text.trim();
  if (clean === '') return { iso: '' };
  const match = RU_DAY.exec(clean);
  const iso = match ? toIso(Number(match[1]), Number(match[2]), Number(match[3])) : null;
  if (!iso) return { iso: '', error: DATE_FORMAT_ERROR };
  if (max && iso > max) return { iso: '', error: `Не позже ${isoToRuDate(max)}` };
  return { iso };
}

const GROUP_LIMITS = [2, 2, 4] as const;

/** Точки ставятся сами: лишняя цифра дня или месяца уходит в следующую группу. */
export function formatDateTyping(text: string): string {
  const groups = text.replace(/[^\d.]/g, '').split('.');
  const out: string[] = [];
  let pending = groups.shift() ?? '';
  for (;;) {
    const limit = GROUP_LIMITS[out.length];
    if (out.length < 2 && pending.length > limit) {
      out.push(pending.slice(0, limit));
      pending = pending.slice(limit);
      continue;
    }
    out.push(pending.slice(0, limit));
    if (groups.length === 0 || out.length === GROUP_LIMITS.length) break;
    pending = groups.shift() ?? '';
  }
  return out.join('.');
}
