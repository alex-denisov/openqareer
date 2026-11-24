import {
  HH_WINDOW_LEFT_OPEN_FAILURES,
  HH_WINDOW_WATCH_MS,
} from '../../../../../shared/hhCandidateSession';
import { CoachApiError } from '../../../coach/apiClient';
import { readHhApplyWindow } from './hhDesktop';
import { hideHhWindow } from './hhPersonWindow';
import { finishHhApply } from './hhSessionApi';

export const HH_WATCH_STEP_MS = 3000;
export const HH_WATCH_LIMIT_MS = HH_WINDOW_WATCH_MS;

export interface HhWindowWatchInput {
  readonly attemptId: string;
  readonly vacancyId: string;
  readonly failureCode: string | null | undefined;
  readonly onSent: () => Promise<void>;
}

const LEFT_OPEN: ReadonlySet<string> = new Set(HH_WINDOW_LEFT_OPEN_FAILURES);

/** Окно hh.ru одно, поэтому и чтение одно; живёт вне экрана, чтобы отметка не терялась при уходе с него. */
let current: symbol | null = null;

export function stopHhWindowWatch(): void {
  current = null;
}

/** Сначала исход на сервере: он отклонит чужую, другую или завершённую попытку — тогда отметки нет. */
async function record({
  attemptId,
  vacancyId,
  onSent,
}: HhWindowWatchInput): Promise<'done' | 'refused' | 'retry'> {
  try {
    await finishHhApply(attemptId, 'sent', undefined, vacancyId);
  } catch (reason: unknown) {
    return reason instanceof CoachApiError && !reason.retryable ? 'refused' : 'retry';
  }
  await onSent().catch(() => undefined);
  return 'done';
}

/** B708: ждёт отклика, который кандидат завершил сам в окне hh.ru. `true` — отклик отмечен. */
export async function watchHhWindow(input: HhWindowWatchInput): Promise<boolean> {
  if (!input.failureCode || !LEFT_OPEN.has(input.failureCode)) return false;
  const own = Symbol('hh-window-watch');
  current = own;
  const deadline = Date.now() + HH_WATCH_LIMIT_MS;
  while (Date.now() < deadline) {
    // Отказ команды — окно закрыто или приложение её не знает: читать больше нечего.
    const seen = await readHhApplyWindow(input.vacancyId).catch(() => null);
    if (current !== own || seen === null) return false;
    if (seen === 'sent') {
      await hideHhWindow();
      const recorded = await record(input);
      if (recorded !== 'retry') return recorded === 'done';
    }
    await new Promise((resolve) => setTimeout(resolve, HH_WATCH_STEP_MS));
    if (current !== own) return false;
  }
  return false;
}
