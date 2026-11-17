import type { B640HiddenInfo } from '../../../../../shared/b640Vacancies';
import type { HiddenRow } from '../b640Api';
import { HIDE_REASONS } from '../skipApi';

function shortDay(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', timeZone: 'Europe/Moscow' }).format(date);
}

/** Текст ⓘ: «Скрыто дд.мм · причина»; причины, которой нет в списке окна, нет и в тексте. */
export function hiddenNote(hidden: B640HiddenInfo): string {
  const day = shortDay(hidden.at);
  const reason = HIDE_REASONS.find((entry) => entry.id === hidden.reasonId)?.label;
  return ['Скрыто' + (day ? ` ${day}` : ''), reason].filter(Boolean).join(' · ');
}

/** Скрытые в этой сессии идут первыми; строки с сервера, уже показанные выше, пропускаются. */
export function mergeHidden(session: readonly HiddenRow[], server: readonly HiddenRow[]): readonly HiddenRow[] {
  const seen = new Set(session.map((row) => row.cluster.id));
  return [...session, ...server.filter((row) => !seen.has(row.cluster.id))];
}
