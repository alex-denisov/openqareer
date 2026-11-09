/**
 * Темп постов (решение владельца 09.11): 3–5 в день на старте, рост до 8–10.
 * Эталоны Threads: минимум одна ветка в день, окна 7–10 и 17–22 по Москве.
 */
export const SMM_START_PER_DAY = 4;
export const SMM_MAX_PER_DAY = 9;
/** Каждые десять принятых постов добавляют один в день. */
export const SMM_ACCEPTED_PER_STEP = 10;
/** Черновик без решения владельца — новый не шлём. */
export const SMM_MAX_PENDING = 1;
/** Решение владельца 09.11: один пост в час, следующий — после его реакции на предыдущий. */
export const SMM_POST_GAP_MS = 60 * 60_000;

const MSK_OFFSET_MS = 3 * 60 * 60_000;
const DAY_MS = 24 * 60 * 60_000;
const WINDOW_START_H = 7;
const WINDOW_END_H = 22;

export function dailyTarget(acceptedTotal: number): number {
  return Math.min(
    SMM_MAX_PER_DAY,
    SMM_START_PER_DAY + Math.floor(acceptedTotal / SMM_ACCEPTED_PER_STEP),
  );
}

/** Начало текущих московских суток в UTC-миллисекундах. */
export function mskDayStart(nowMs: number): number {
  return Math.floor((nowMs + MSK_OFFSET_MS) / DAY_MS) * DAY_MS - MSK_OFFSET_MS;
}

/** Время n-го слота дня: слоты равномерно делят окно 07:00–22:00 МСК. */
export function slotTime(dayStartMs: number, index: number, target: number): number {
  const windowMs = (WINDOW_END_H - WINDOW_START_H) * 60 * 60_000;
  return (
    dayStartMs + WINDOW_START_H * 60 * 60_000 + Math.floor((windowMs * index) / Math.max(1, target))
  );
}

export interface DueInput {
  readonly nowMs: number;
  readonly createdToday: number;
  readonly acceptedTotal: number;
  readonly pending: number;
  readonly lastCreatedMs: number | null;
}

export function isPostDue(input: DueInput): boolean {
  const target = dailyTarget(input.acceptedTotal);
  if (input.createdToday >= target || input.pending >= SMM_MAX_PENDING) return false;
  if (input.lastCreatedMs !== null && input.nowMs - input.lastCreatedMs < SMM_POST_GAP_MS)
    return false;
  const day = mskDayStart(input.nowMs);
  return input.nowMs >= slotTime(day, 0, target) && input.nowMs < day + WINDOW_END_H * 60 * 60_000;
}
