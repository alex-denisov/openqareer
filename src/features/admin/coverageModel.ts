import { COVERAGE_CLASS_ORDER, type CoverageClass, type CoveragePlacement, type CoverageTotals } from './coverageApi';

/** B643-11: подписи и вычисления экрана «Покрытие компаний». */
export const COVERAGE_CLASS_LABELS: Readonly<Record<CoverageClass, string>> = {
  ats: 'ATS',
  site: 'Сайт',
  aggregator_only: 'Только агрегатор',
  linkedin_only: 'Только LinkedIn',
  none: 'Нет размещения',
};

/** Итоги сервер кэширует на 10 минут; старше — пересчёт не прошёл. */
export const COVERAGE_STALE_MS = 10 * 60_000;

const ATS_NAMES: Readonly<Record<string, string>> = {
  greenhouse: 'Greenhouse',
  lever: 'Lever',
  smartrecruiters: 'SmartRecruiters',
  workday: 'Workday',
  ashby: 'Ashby',
  recruitee: 'Recruitee',
  workable: 'Workable',
  personio: 'Personio',
  teamtailor: 'Teamtailor',
};

export type HealthTone = 'ok' | 'error' | 'warn' | 'none';

const HEALTH: Readonly<Record<string, { label: string; tone: HealthTone }>> = {
  healthy: { label: 'работает', tone: 'ok' },
  error: { label: 'ошибка', tone: 'error' },
  degraded: { label: 'замедлен', tone: 'warn' },
};

const NEVER_CHECKED = { label: 'ещё не проверялось', tone: 'none' as const };

export function healthView(health: string | null): { label: string; tone: HealthTone } {
  if (health === null) return NEVER_CHECKED;
  return HEALTH[health] ?? { label: 'состояние неизвестно', tone: 'none' };
}

export function placementName(placement: CoveragePlacement): string {
  if (placement.type === 'ats') return ATS_NAMES[placement.id.split(':')[1] ?? ''] ?? 'ATS';
  if (placement.type === 'linkedin') return 'LinkedIn';
  if (placement.type === 'aggregator') return 'Агрегатор';
  return placement.domain ?? 'Сайт';
}

export function poolTotal(totals: CoverageTotals): number {
  return COVERAGE_CLASS_ORDER.reduce((sum, cls) => sum + totals.classes[cls].vacancies, 0);
}

export function directShare(totals: CoverageTotals): number {
  return totals.classes.ats.companies + totals.classes.site.companies;
}

export function percentLabel(value: number): string {
  if (value === 0) return '0 %';
  if (value < 0.1) return 'меньше 0,1 %';
  return `${value.toLocaleString('ru-RU', { maximumFractionDigits: 1 })} %`;
}

export function shareLabel(part: number, whole: number): string {
  return percentLabel(whole > 0 ? (part / whole) * 100 : 0);
}

const numberFormat = new Intl.NumberFormat('ru-RU');

export function formatCount(value: number): string {
  return numberFormat.format(value);
}

export function agoLabel(at: number, now: number): string {
  const minutes = Math.max(1, Math.round((now - at) / 60_000));
  if (minutes < 60) return `${minutes} мин назад`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ч назад`;
  return `${Math.round(hours / 24)} дн назад`;
}

export function isStale(computedAt: number, now: number): boolean {
  return now - computedAt > COVERAGE_STALE_MS;
}

export function computedAtLabel(computedAt: number): string {
  return new Date(computedAt).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
