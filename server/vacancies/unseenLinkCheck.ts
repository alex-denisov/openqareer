import { probeVacancyLinks, type LinkProbe } from './linkLivenessProbe';
import type { UnseenLink, VacancyLink, VacancyPoolStore } from './vacancyPoolStore';

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
/** Невиденных читается за такт; следующий такт продолжает с места остановки. */
export const UNSEEN_PAGE_ROWS = 2_000;
/** Ссылок одного хоста за такт: чужой сервер не нагружается, молчащая площадка не занимает весь такт. */
export const UNSEEN_PER_HOST = 5;
const UNSEEN_CONCURRENCY = 4;

/** Память обхода: когда спрашивали ссылку и где остановились. */
export class UnseenLinkWalk {
  readonly askedAt = new Map<string, number>();
  cursor: UnseenLink | undefined;
}

function hostOf(link: VacancyLink): string {
  return URL.canParse(link.url) ? new URL(link.url).hostname : '';
}

function pickDue(
  candidates: readonly UnseenLink[],
  walk: UnseenLinkWalk,
  nowMs: number,
): VacancyLink[] {
  const perHost = new Map<string, number>();
  const due: VacancyLink[] = [];
  for (const link of candidates) {
    if (due.length >= UNSEEN_PROBE_LIMIT) break;
    if (nowMs - (walk.askedAt.get(link.id) ?? 0) < UNSEEN_REPROBE_MS) continue;
    const host = hostOf(link);
    const taken = perHost.get(host) ?? 0;
    if (taken >= UNSEEN_PER_HOST) continue;
    perHost.set(host, taken + 1);
    due.push(link);
  }
  return due;
}

/**
 * Страница невиденных, недавние первыми. Раньше каждый такт читал одни и те же самые давние
 * записи: площадка без ответа («неизвестно») держала очередь, до остальных она не доходила.
 */
function nextPage(
  pool: VacancyPoolStore,
  sourceIds: readonly string[],
  walk: UnseenLinkWalk,
  nowMs: number,
): readonly UnseenLink[] {
  const read = (after?: UnseenLink) =>
    pool.loadUnseenLinks?.(sourceIds, nowMs - UNSEEN_PROBE_AFTER_MS, UNSEEN_PAGE_ROWS, after) ?? [];
  const page = walk.cursor ? read(walk.cursor) : [];
  const links = page.length > 0 ? page : read();
  const last = links.at(-1);
  walk.cursor = last && links.length === UNSEEN_PAGE_ROWS ? last : undefined;
  return links;
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
  const due = pickDue(nextPage(pool, sourceIds, walk, nowMs), walk, nowMs);
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
