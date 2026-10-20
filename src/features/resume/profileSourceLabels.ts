import type { CandidateConnection } from '../coach/coachApi';

export function connectionStatusLabel(status: CandidateConnection['status'] | undefined): string {
  if (status === 'connected') return 'Подключено';
  if (status === 'imported') return 'Импортировано';
  if (status === 'disconnected') return 'Не подключено';
  return 'Не импортировано';
}

export function factCountLabel(count: number): string {
  const rest100 = count % 100;
  const rest10 = count % 10;
  const noun =
    rest100 >= 11 && rest100 <= 14
      ? 'фактов'
      : rest10 === 1
        ? 'факт'
        : rest10 >= 2 && rest10 <= 4
          ? 'факта'
          : 'фактов';
  return `${count} ${noun}`;
}

/**
 * The candidate's time zone from the account (B541): profile dates read in it,
 * not in UTC — an import at 02:00 Moscow is «21.10», not «20.10». Unset, the
 * device's own zone is used.
 */
let candidateTimeZone: string | undefined;

export function setCandidateTimeZone(timeZone: string | null | undefined): void {
  candidateTimeZone = timeZone && isKnownTimeZone(timeZone) ? timeZone : undefined;
}

function isKnownTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('ru-RU', { timeZone });
    return true;
  } catch {
    return false;
  }
}

export function importDateLabel(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  const parts = new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    ...(candidateTimeZone ? { timeZone: candidateTimeZone } : {}),
  }).format(date);
  return parts.replace(/\.$/u, '');
}
