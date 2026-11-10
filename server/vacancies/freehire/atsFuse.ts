/**
 * Предохранитель порций досок ATS (B641, решение CPO 10.11): если стоянки очереди
 * событий обслуживания или число вакансий от досок ATS выросли больше чем в 1,5 раза
 * против замера до включения, доски перестают приносить новые вакансии до перезапуска
 * процесса. Срез уже прочитанного сохраняется (частичное чтение без строк).
 */

/** Сумма стоянок от 1 с за час, замер журнала обслуживания 10.11 (последние 6 ч). */
export const STALL_BASELINE_SECONDS_PER_HOUR = 2_200;
/** Вакансий в пуле до включения досок (10.11). */
export const POOL_BASELINE_VACANCIES = 848_000;
export const FUSE_RATIO = 1.5;

const HOUR_MS = 3_600_000;

interface FuseState {
  readonly startedAt: number;
  stalls: { at: number; ms: number }[];
  readonly atsCounts: Map<string, number>;
  trippedReason: string | undefined;
}

let state: FuseState = fresh(Date.now());

function fresh(now: number): FuseState {
  return { startedAt: now, stalls: [], atsCounts: new Map(), trippedReason: undefined };
}

export function resetAtsFuse(now: number = Date.now()): void {
  state = fresh(now);
}

export function recordEventLoopStall(ms: number, now: number = Date.now()): void {
  state.stalls = [...state.stalls.filter((s) => s.at > now - HOUR_MS), { at: now, ms }];
}

/**
 * Полное чтение задаёт число вакансий доски. Частичное чтение sitemap уже несёт всё
 * прочитанное, а Oracle — только новые строки опроса, их прибавляем.
 */
export function recordAtsReading(sourceId: string, vacancies: number, partial: boolean): void {
  const adds = partial && sourceId.startsWith('src-fh-oracle-');
  const before = adds ? (state.atsCounts.get(sourceId) ?? 0) : 0;
  state.atsCounts.set(sourceId, before + vacancies);
}

function stallSecondsLastHour(now: number): number {
  return state.stalls.filter((s) => s.at > now - HOUR_MS).reduce((sum, s) => sum + s.ms, 0) / 1000;
}

function atsVacancies(): number {
  return [...state.atsCounts.values()].reduce((sum, n) => sum + n, 0);
}

/** Причина срабатывания или undefined. Сработав, держится до перезапуска. */
export function atsFuseTripped(now: number = Date.now()): string | undefined {
  if (state.trippedReason) return state.trippedReason;
  const ats = atsVacancies();
  if (POOL_BASELINE_VACANCIES + ats > POOL_BASELINE_VACANCIES * FUSE_RATIO) {
    state.trippedReason = `вакансий от досок ATS ${ats}: пул больше ${FUSE_RATIO}× замера`;
  }
  // Окно стоянок оценивается только после полного часа работы процесса.
  const stalls = stallSecondsLastHour(now);
  if (now - state.startedAt >= HOUR_MS && stalls > STALL_BASELINE_SECONDS_PER_HOUR * FUSE_RATIO) {
    state.trippedReason = `стоянки ${Math.round(stalls)} с за час: больше ${FUSE_RATIO}× замера`;
  }
  return state.trippedReason;
}
