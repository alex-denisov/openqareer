export interface CareerDiaryWeek {
  readonly weekStart: string;
  readonly weekEnd: string;
  readonly number: number | null;
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export function currentCareerDiaryWeek(asOf: string, workplaceStart: string | null): CareerDiaryWeek {
  const weekStart = mondayOf(asOf);
  const end = new Date(weekStart + 'T00:00:00.000Z');
  end.setUTCDate(end.getUTCDate() + 6);
  const firstWeek = workplaceStart ? mondayOf(workplaceStart) : null;
  const elapsedWeeks = firstWeek ? Math.floor((Date.parse(weekStart) - Date.parse(firstWeek)) / WEEK_MS) : -1;

  return {
    weekStart,
    weekEnd: end.toISOString().slice(0, 10),
    number: elapsedWeeks >= 0 ? elapsedWeeks + 1 : null,
  };
}

function mondayOf(value: string): string {
  const date = new Date(value + 'T00:00:00.000Z');
  const weekday = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - weekday + 1);
  return date.toISOString().slice(0, 10);
}
