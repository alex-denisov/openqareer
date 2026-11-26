import { HH_RAISE_CLOCK, type HhRaiseOutcome } from '../../../../../shared/b640HhRaise';
import { invokeDesktopCommand, isTauriEnvironment } from '../../../../services/desktop/desktopBridge';
import { claimHhRaise, sendHhRaiseResult } from '../../platforms/hh/hhRaiseApi';

/** B699: как часто настольное приложение спрашивает сервер, не пора ли поднять резюме. */
export const HH_RAISE_POLL_MS = 5 * 60 * 1000;

const OUTCOMES: readonly HhRaiseOutcome[] = ['ok', 'captcha', 'logged_out', 'foreign_page', 'too_early', 'error'];

interface HhRaiseReport {
  readonly outcome: string;
  readonly availableAt?: string;
}

/**
 * Один шаг: взять задание, поднять резюме в окне hh.ru кандидата, отправить исход.
 * `busy` (окно занято откликом) исход не отправляет: задание вернётся по сроку на сервере.
 */
export async function runHhRaiseOnce(): Promise<void> {
  const { task } = await claimHhRaise();
  if (!task) return;
  let outcome: HhRaiseOutcome = 'error';
  let availableAt: string | undefined;
  try {
    // Код окна грузится только под задание, чтобы не утяжелять кабинет.
    const { ensureHhWindow } = await import('./hhWindow');
    const signedOut = (await ensureHhWindow()) === 'signed_out';
    const report = signedOut
      ? ({ outcome: 'logged_out' } as HhRaiseReport)
      : await invokeDesktopCommand<HhRaiseReport>('run_hh_raise', { request: { resumeId: task.resumeId } });
    if (report?.outcome === 'busy') return;
    const reported = report?.outcome as HhRaiseOutcome | undefined;
    if (reported && OUTCOMES.includes(reported)) outcome = reported;
    if (outcome === 'too_early' && HH_RAISE_CLOCK.test(report?.availableAt ?? '')) availableAt = report?.availableAt;
  } catch {
    // Окно не открылось или сбой команды: исход «error», кандидат увидит «Повторить».
  }
  await sendHhRaiseResult(task.taskId, outcome, availableAt);
}

let running = false;
let requested = false;

/** Шаг опроса без наложения на идущий; просьба во время шага исполняется сразу после него. */
function step(): void {
  if (running) return;
  running = true;
  requested = false;
  runHhRaiseOnce()
    .catch(() => undefined)
    .finally(() => {
      running = false;
      if (requested) step();
    });
}

/** Кандидат нажал «Повторить» или включил автоподнятие: не ждать очередного опроса. */
export function requestHhRaiseStep(): void {
  if (!isTauriEnvironment()) return;
  requested = true;
  step();
}

/**
 * Опрос раз в 5 минут, только в настольном приложении; в браузере не запускается.
 * Возвращает остановку. Шаги не накладываются друг на друга.
 */
export function startHhRaisePoller(intervalMs: number = HH_RAISE_POLL_MS): () => void {
  if (!isTauriEnvironment()) return () => undefined;
  step();
  const timer = setInterval(step, intervalMs);
  return () => clearInterval(timer);
}
