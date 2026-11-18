/**
 * B676: защита чужих сайтов, а не квота кандидата. Чтение страницы идёт с нашего адреса и
 * нашим User-Agent, поэтому у кандидата одно чтение за раз и не больше 10 за 10 минут.
 */
const WINDOW_MS = 10 * 60_000;
const WINDOW_MAX = 10;

const active = new Set<string>();
const recent = new Map<string, readonly number[]>();

export type LinkReadSlot = { readonly ok: true; readonly release: () => void } | { readonly ok: false };

export function takeLinkReadSlot(candidateId: string, now = Date.now()): LinkReadSlot {
  const kept = (recent.get(candidateId) ?? []).filter((at) => now - at < WINDOW_MS);
  if (active.has(candidateId) || kept.length >= WINDOW_MAX) {
    recent.set(candidateId, kept);
    return { ok: false };
  }
  active.add(candidateId);
  recent.set(candidateId, [...kept, now]);
  return { ok: true, release: () => active.delete(candidateId) };
}

export function forgetLinkReadSlotsForTests(): void {
  active.clear();
  recent.clear();
}
