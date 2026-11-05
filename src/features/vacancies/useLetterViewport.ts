import { useEffect, useLayoutEffect, useState, type RefObject } from 'react';

/** Below this the visual viewport shrank because of browser toolbars, not a keyboard. */
const KEYBOARD_MIN_PX = 120;

/** How much of the layout viewport the on-screen keyboard covers. */
export function keyboardInsetPx(
  layoutHeight: number,
  viewport: { readonly height: number; readonly offsetTop: number } | null | undefined,
): number {
  if (!viewport) return 0;
  const shrunk = layoutHeight - viewport.height;
  if (shrunk < KEYBOARD_MIN_PX) return 0;
  return Math.max(0, Math.round(shrunk - viewport.offsetTop));
}

/** The keyboard does not resize the layout viewport, so a sticky bottom would hide behind it. */
export function useKeyboardInset(enabled: boolean): number {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!enabled || !viewport) return;
    const update = () => setInset(keyboardInsetPx(window.innerHeight, viewport));
    update();
    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
    return () => {
      viewport.removeEventListener('resize', update);
      viewport.removeEventListener('scroll', update);
    };
  }, [enabled]);
  return enabled ? inset : 0;
}

/** Letter text is read whole: the field grows with it and never scrolls inside (mockup 9). */
export function useAutoGrowTextarea(
  target: RefObject<HTMLTextAreaElement | null>,
  text: string,
): void {
  useLayoutEffect(() => {
    const fit = () => {
      const area = target.current;
      if (!area) return;
      area.style.height = 'auto';
      area.style.height = `${area.scrollHeight}px`;
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [target, text]);
}
