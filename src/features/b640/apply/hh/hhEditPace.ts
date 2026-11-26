/** B678: между разделами «Применить все» — пауза, как у человека: 3–8 с с разбросом. */
const PAUSE_MIN_MS = 3_000;
const PAUSE_SPREAD_MS = 5_000;

export function pauseBetweenEdits(): Promise<void> {
  const ms = PAUSE_MIN_MS + Math.floor(Math.random() * PAUSE_SPREAD_MS);
  return new Promise((resolve) => setTimeout(resolve, ms));
}
