import { keepKeyOf } from './journey';

const RESTORE_MS = 3000;
const PHONE = '(max-width: 767px)';
const CANCEL_EVENTS = ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const;

const positions = new Map<string, number>();
let current = '';
let returning = false;
let pending: number | null = null;
let stop: (() => void) | null = null;

export function hereAddress(): string {
  return `${window.location.pathname}${window.location.search}`;
}

/** Место помнится по ходу прокрутки: к «Назад» браузера новый экран может быть уже нарисован. */
function remember(): void {
  if (current === hereAddress()) positions.set(current, window.scrollY);
}

/** Адрес сменил браузер, а не кабинет: «Назад» или «Вперёд». */
function movedByBrowser(): boolean {
  return current !== '' && current !== hereAddress();
}

/** Последний переход — возврат: список открывается прежним. */
export function isReturning(): boolean {
  return returning || movedByBrowser();
}

function isPhone(): boolean {
  return window.matchMedia?.(PHONE).matches ?? false;
}

/** До перехода: запомнить место и решить, где встанет новый экран. */
export function beforeNavigate(to: string, back: boolean): void {
  stop?.();
  remember();
  returning = back;
  const from = keepKeyOf(current || hereAddress());
  // Строка отклика раскрывается на месте: список под ней не прыгает. На 390 её показывают одну.
  const inPlace = from !== null && from === keepKeyOf(to) && !isPhone();
  pending = inPlace ? window.scrollY : back ? (positions.get(to) ?? null) : null;
  current = to;
}

/** Адрес после перехода: приложение могло увести не туда, куда просили. */
export function arrived(): void {
  current = hereAddress();
}

function settleMove(): void {
  if (!movedByBrowser()) return;
  stop?.();
  returning = true;
  current = hereAddress();
  pending = positions.get(current) ?? 0;
}

/** Вернуть место экрана: сразу, а если список ещё дочитывается — когда высоты хватит. */
export function restoreScroll(): void {
  settleMove();
  if (pending === null) return;
  const target = pending;
  pending = null;
  const started = performance.now();
  let frame = 0;
  const cancel = () => {
    cancelAnimationFrame(frame);
    for (const name of CANCEL_EVENTS) window.removeEventListener(name, cancel);
    stop = null;
  };
  stop = cancel;
  for (const name of CANCEL_EVENTS) window.addEventListener(name, cancel, { passive: true });
  const attempt = () => {
    window.scrollTo(0, target);
    const there = Math.abs(window.scrollY - target) <= 1;
    if (there || performance.now() - started > RESTORE_MS) cancel();
    else frame = requestAnimationFrame(attempt);
  };
  attempt();
}

/** Место экрана ведёт кабинет; при перезагрузке — браузер, как раньше. */
export function watchScroll(): () => void {
  current = hereAddress();
  const manual = () => {
    window.history.scrollRestoration = 'manual';
  };
  const auto = () => {
    window.history.scrollRestoration = 'auto';
  };
  manual();
  window.addEventListener('scroll', remember, { passive: true });
  window.addEventListener('pagehide', auto);
  window.addEventListener('pageshow', manual);
  return () => {
    stop?.();
    auto();
    window.removeEventListener('scroll', remember);
    window.removeEventListener('pagehide', auto);
    window.removeEventListener('pageshow', manual);
    positions.clear();
    pending = null;
    returning = false;
    current = '';
  };
}

