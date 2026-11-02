import { setImmediate as yieldToEventLoop } from 'node:timers/promises';

/**
 * Maps a long list without holding the event loop: after each slice of
 * `sliceMs` it lets queued requests run. Prod 02.11: matching every pool
 * cluster for one candidate ran 6–9 s in one piece and stalled /health,
 * assets and every API call behind it.
 */
export async function mapYielding<T, R>(
  items: readonly T[],
  map: (item: T) => R,
  options: { readonly sliceMs?: number; readonly now?: () => number } = {},
): Promise<R[]> {
  const { sliceMs = 20, now = () => performance.now() } = options;
  const result: R[] = [];
  let sliceStart = now();
  for (const item of items) {
    if (now() - sliceStart >= sliceMs) {
      await yieldToEventLoop();
      sliceStart = now();
    }
    result.push(map(item));
  }
  return result;
}
