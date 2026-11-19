import type { B640HhRaiseState } from '../../../../../shared/b640HhRaise';

export type HhRaiseLine =
  | { readonly state: 'off' }
  | { readonly state: 'wait' | 'ok' | 'err'; readonly text: string; readonly action?: 'retry' | 'sign_in' };

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

/** Тихая строка состояния: что видит кандидат, без напоминаний. */
export function lineOf(view: B640HhRaiseState): HhRaiseLine {
  if (!view.connected || !view.enabled) return { state: 'off' };
  if (view.pauseReason === 'logged_out') return { state: 'err', text: 'Войдите в hh.ru заново', action: 'sign_in' };
  if (view.pauseReason === 'captcha' && view.pausedUntil) {
    return { state: 'wait', text: `Пауза до ${clock(view.pausedUntil)}: hh.ru попросил капчу` };
  }
  if (view.lastResult?.status === 'error') return { state: 'err', text: 'Не поднято', action: 'retry' };
  if (view.lastRaisedAt) {
    const next = view.nextRaiseAt ? `, следующее ≈ ${clock(view.nextRaiseAt)}` : '';
    return { state: 'ok', text: `Резюме поднято · ${clock(view.lastRaisedAt)}${next}` };
  }
  const first = view.nextRaiseAt ? ` · первое ≈ ${clock(view.nextRaiseAt)}` : '';
  return { state: 'wait', text: `Резюме будет поднято${first}` };
}
