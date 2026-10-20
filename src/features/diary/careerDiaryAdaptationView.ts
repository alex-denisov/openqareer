import type { CareerDiaryAdaptationTask } from './careerDiaryPlanning';

const DAY_MS = 86_400_000;
const CONSULTANT_TASK_PREFIX = 'coach-';

/** «20.12»: короткая дата строк плана, как в утверждённом макете 10. */
export function formatDayMonth(value: string): string {
  const match = /^\d{4}-(\d{2})-(\d{2})$/u.exec(value);
  return match ? `${match[2]}.${match[1]}` : value;
}

/** Ближайшая невыполненная задача плана по сроку, по всем этапам. */
export function nearestAdaptationTask(
  tasks: readonly CareerDiaryAdaptationTask[],
): CareerDiaryAdaptationTask | null {
  const open = tasks.filter((task) => !task.completed);
  if (!open.length) return null;
  return open.reduce((nearest, task) => (task.dueDate < nearest.dueDate ? task : nearest));
}

export function nearestDueCopy(dueDate: string, asOf: string): string {
  const days = Math.round(
    (Date.parse(`${dueDate}T00:00:00Z`) - Date.parse(`${asOf}T00:00:00Z`)) / DAY_MS,
  );
  if (!Number.isFinite(days)) return '';
  if (days === 0) return 'Срок сегодня.';
  if (days > 0) return `Срок через ${days} ${dayWord(days)}.`;
  return `Срок прошёл ${-days} ${dayWord(-days)} назад.`;
}

export function adaptationTaskOrigin(task: CareerDiaryAdaptationTask): string {
  if (task.source === 'template') return 'из шаблона';
  return task.id.startsWith(CONSULTANT_TASK_PREFIX) ? 'добавлено консультантом' : 'добавлено вами';
}

function dayWord(count: number): string {
  const lastTwo = count % 100;
  const last = count % 10;
  if (lastTwo >= 11 && lastTwo <= 14) return 'дней';
  if (last === 1) return 'день';
  if (last >= 2 && last <= 4) return 'дня';
  return 'дней';
}
