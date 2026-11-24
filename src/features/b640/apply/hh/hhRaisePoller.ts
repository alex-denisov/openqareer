import type { HhRaiseOutcome } from '../../../../../shared/b640HhRaise';
import { invokeDesktopCommand, isTauriEnvironment } from '../../../../services/desktop/desktopBridge';
import { claimHhRaise, sendHhRaiseResult } from '../../platforms/hh/hhRaiseApi';

/** B699: как часто настольное приложение спрашивает сервер, не пора ли поднять резюме. */
export const HH_RAISE_POLL_MS = 5 * 60 * 1000;

const OUTCOMES: readonly HhRaiseOutcome[] = ['ok', 'captcha', 'logged_out', 'foreign_page', 'too_early', 'error'];

interface HhRaiseReport {
  readonly outcome: string;
}

/**
 * Один шаг: взять задание, поднять резюме в окне hh.ru кандидата, отправить исход.
 * `busy` (окно занято откликом) исход не отправляет: задание вернётся по сроку на сервере.
 */
export async function runHhRaiseOnce(): Promise<void> {
  const { task } = await claimHhRaise();
  if (!task) return;
  let outcome: HhRaiseOutcome = 'error';
  try {
    // Код окна грузится только под задание, чтобы не утяжелять кабинет.
    const { ensureHhWindow } = await import('./hhWindow');
    const signedOut = (await ensureHhWindow()) === 'signed_out';
    const report = signedOut
      ? { outcome: 'logged_out' }
      : await invokeDesktopCommand<HhRaiseReport>('run_hh_raise', { request: { resumeId: task.resumeId } });
    if (report?.outcome === 'busy') return;
    const reported = report?.outcome as HhRaiseOutcome | undefined;
    if (reported && OUTCOMES.includes(reported)) outcome = reported;
  } catch {
    // Окно не открылось или сбой команды: исход «error», кандидат увидит «Повторить».
  }
  await sendHhRaiseResult(task.taskId, outcome);
}

/**
 * Опрос раз в 5 минут, только в настольном приложении; в браузере не запускается.
 * Возвращает остановку. Шаги не накладываются друг на друга.
 */
export function startHhRaisePoller(intervalMs: number = HH_RAISE_POLL_MS): () => void {
  if (!isTauriEnvironment()) return () => undefined;
  let running = false;
  const tick = () => {
    if (running) return;
    running = true;
    runHhRaiseOnce()
      .catch(() => undefined)
      .finally(() => {
        running = false;
      });
  };
  tick();
  const timer = setInterval(tick, intervalMs);
  return () => clearInterval(timer);
}
