import type { B640HhRaiseState } from '../../../../../shared/b640HhRaise';

export type HhRaiseLine =
  | { readonly state: 'off' }
  | {
      readonly state: 'wait' | 'ok' | 'err';
      readonly text: string;
      readonly action?: 'retry' | 'sign_in' | 'captcha';
    };

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

/** Время подъёма, если оно ещё впереди; прошедшее не показываем — поднимет сессия приложения, когда будет открыта. */
const ahead = (iso: string | null, now: number): string | null =>
  iso && Date.parse(iso) > now ? clock(iso) : null;

/** Тихая строка состояния: что видит кандидат, без напоминаний. */
export function lineOf(view: B640HhRaiseState, now: number = Date.now()): HhRaiseLine {
  if (!view.connected || !view.enabled) return { state: 'off' };
  if (view.pauseReason === 'logged_out')
    return { state: 'err', text: 'Войдите в hh.ru заново', action: 'sign_in' };
  // Задание уже стоит в очереди или исполняется: прошлый исход больше не показываем.
  if (view.pending) return { state: 'wait', text: 'Резюме будет поднято' };
  if (view.pauseReason === 'captcha' && view.pausedUntil) {
    return { state: 'wait', text: `Пауза до ${clock(view.pausedUntil)}: hh.ru попросил капчу`, action: 'captcha' };
  }
  // «Ещё рано» — не сбой: hh.ru поднимет резюме в следующий срок.
  const tooEarly = view.lastResult?.reason === 'too_early';
  if (view.lastResult?.status === 'error' && !tooEarly)
    return { state: 'err', text: 'Не поднято', action: 'retry' };
  if (view.lastRaisedAt) {
    const nextAt = ahead(view.nextRaiseAt, now);
    const next = nextAt ? `, следующее ≈ ${nextAt}` : '';
    return { state: 'ok', text: `Резюме поднято · ${clock(view.lastRaisedAt)}${next}` };
  }
  const firstAt = ahead(view.nextRaiseAt, now);
  const first = firstAt ? ` · ${tooEarly ? 'следующее' : 'первое'} ≈ ${firstAt}` : '';
  return { state: 'wait', text: `Резюме будет поднято${first}` };
}
