import { probeVacancyLinks, type LinkProbe } from './linkLivenessProbe';
import type { VacancyLink, VacancyPoolStore } from './vacancyPoolStore';

/**
 * B642 — вакансия работодателя, которой не было в последнем полном чтении
 * (источник упал или прочитан частично), проверяется по ссылке: 404/410 или
 * переход на список — снята сразу, открылась — считается виденной. Правило
 * «не видели 7 дней» остаётся запасным для ссылок, которые проверить нельзя.
 */

/** Запись, невиденная дольше суток, идёт в проверку (доски читаются раз в 3 ч). */
export const UNSEEN_PROBE_AFTER_MS = 24 * 60 * 60 * 1000;
/** Одна и та же ссылка с ответом «неизвестно» спрашивается не чаще раза в 6 ч. */
export const UNSEEN_REPROBE_MS = 6 * 60 * 60 * 1000;
/** Ссылок за такт. */
export const UNSEEN_PROBE_LIMIT = 100;
/** Ссылок одного источника за такт: чужой сервер не нагружается, молчащий не занимает весь такт. */
export const UNSEEN_PER_SOURCE = 2;
/** Источников за такт не больше: у каждого — одно короткое чтение по индексу. */
export const UNSEEN_SOURCES_PER_TICK = 2_000;
/** Из стольких невиденных записей источника выбираются ссылки такта. */
const UNSEEN_SOURCE_ROWS = 50;
const UNSEEN_CONCURRENCY = 4;

/** Память обхода: когда спрашивали ссылку и с какого источника продолжать. */
export class UnseenLinkWalk {
  readonly askedAt = new Map<string, number>();
  /** Начало случайное: после перезапуска обход не проходит одно и то же начало списка. */
  constructor(
    public position = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER),
    readonly random: () => number = Math.random,
  ) {}
}

/** Несколько ссылок источника, каждый раз другие: первые без ответа не закрывают остальные. */
function pickFromSource(
  links: readonly VacancyLink[],
  walk: UnseenLinkWalk,
  nowMs: number,
): readonly VacancyLink[] {
  const due = links.filter((link) => nowMs - (walk.askedAt.get(link.id) ?? 0) >= UNSEEN_REPROBE_MS);
  if (due.length <= UNSEEN_PER_SOURCE) return due;
  const start = Math.floor(walk.random() * due.length);
  return Array.from({ length: UNSEEN_PER_SOURCE }, (_, step) => due[(start + step) % due.length]!);
}

/**
 * Ссылки такта — по кругу источников. Раньше каждый такт читал одни и те же самые давние записи
 * пула: площадка без ответа («неизвестно») держала очередь, до остальных она не доходила.
 */
function nextDue(
  pool: VacancyPoolStore,
  sourceIds: readonly string[],
  walk: UnseenLinkWalk,
  nowMs: number,
): readonly VacancyLink[] {
  const due: VacancyLink[] = [];
  const turns = Math.min(sourceIds.length, UNSEEN_SOURCES_PER_TICK);
  for (let turn = 0; turn < turns && due.length < UNSEEN_PROBE_LIMIT; turn += 1) {
    const sourceId = sourceIds[walk.position % sourceIds.length]!;
    walk.position = (walk.position + 1) % sourceIds.length;
    const links =
      pool.loadUnseenLinks?.([sourceId], nowMs - UNSEEN_PROBE_AFTER_MS, UNSEEN_SOURCE_ROWS) ?? [];
    due.push(...pickFromSource(links, walk, nowMs));
  }
  return due.slice(0, UNSEEN_PROBE_LIMIT);
}

export interface UnseenLinkReport {
  readonly checked: number;
  readonly gone: number;
  readonly open: number;
  readonly unknown: number;
}

export interface UnseenLinkResult extends UnseenLinkReport {
  readonly goneLinks: readonly VacancyLink[];
}

const EMPTY: UnseenLinkResult = { checked: 0, gone: 0, open: 0, unknown: 0, goneLinks: [] };

export async function checkUnseenLinks(
  pool: VacancyPoolStore,
  probe: LinkProbe,
  sourceIds: readonly string[],
  walk: UnseenLinkWalk,
  nowMs: number,
): Promise<UnseenLinkResult> {
  if (!pool.loadUnseenLinks || !pool.markSeen) return EMPTY;
  const due = nextDue(pool, sourceIds, walk, nowMs);
  if (due.length === 0) return EMPTY;
  // Забытые отметки не копятся: дольше срока повтора они ни на что не влияют.
  for (const [id, at] of walk.askedAt) if (nowMs - at >= UNSEEN_REPROBE_MS) walk.askedAt.delete(id);
  due.forEach((link) => walk.askedAt.set(link.id, nowMs));
  const { census, goneVacancyIds, openVacancyIds } = await probeVacancyLinks(due, probe, {
    sample: due.length,
    concurrency: UNSEEN_CONCURRENCY,
    nowMs,
  });
  if (goneVacancyIds.length > 0) pool.markExpired(goneVacancyIds, census.checkedAt);
  pool.markSeen(openVacancyIds, nowMs);
  const goneSet = new Set(goneVacancyIds);
  return {
    checked: census.checked,
    gone: census.gone,
    open: census.open,
    unknown: census.unknown,
    goneLinks: due.filter((link) => goneSet.has(link.id)),
  };
}
