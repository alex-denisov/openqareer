import { performance } from 'node:perf_hooks';

/**
 * B770a-0 (прод 23.11): шаги фона идут секундами с уступками и только перекрывают задержки event
 * loop; кто держит поток сам, по перекрытию не видно. Именованный синхронный участок пишет своё
 * время, журнал задержки называет участки из своего окна. Только имя и миллисекунды, без данных.
 */
interface Section {
  readonly name: string;
  readonly startedAt: number;
  readonly ms: number;
}

/** Участки короче не держат поток заметно и только вытесняли бы длинные из буфера. */
const MIN_RECORDED_MS = 5;
const MAX_KEPT = 256;
const MAX_NAMED = 8;

let kept: Section[] = [];

export function recordSyncSection(name: string, startedAt: number, ms: number): void {
  if (ms < MIN_RECORDED_MS) return;
  kept = [...kept.slice(-(MAX_KEPT - 1)), { name, startedAt, ms }];
}

/** Синхронная часть `run` под именем `name`; обещание дальше идёт без учёта. */
export function syncSection<T>(name: string, run: () => T): T {
  const startedAt = performance.now();
  try {
    return run();
  } finally {
    recordSyncSection(name, startedAt, performance.now() - startedAt);
  }
}

export interface HeldSyncSection {
  readonly name: string;
  readonly ms: number;
}

/** Участки, шедшие в окне задержки: сумма по имени, длинное первым. */
export function heldSyncSections(windowStart: number, now: number): HeldSyncSection[] {
  const byName = new Map<string, number>();
  for (const section of kept) {
    const end = section.startedAt + section.ms;
    if (end < windowStart || section.startedAt > now) continue;
    byName.set(section.name, (byName.get(section.name) ?? 0) + section.ms);
  }
  return [...byName.entries()]
    .map(([name, ms]) => ({ name, ms: Math.round(ms) }))
    .sort((a, b) => b.ms - a.ms)
    .slice(0, MAX_NAMED);
}

export function resetSyncSections(): void {
  kept = [];
}
