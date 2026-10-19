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

export function importDateLabel(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  const parts = new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'UTC',
  }).format(date);
  return parts.replace(/\.$/u, '');
}
