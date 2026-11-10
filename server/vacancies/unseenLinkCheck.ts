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
/** Ссылок за такт — как у выборочной проверки B200. */
export const UNSEEN_PROBE_LIMIT = 20;

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
  askedAt: Map<string, number>,
  nowMs: number,
): Promise<UnseenLinkResult> {
  if (!pool.loadUnseenLinks || !pool.markSeen) return EMPTY;
  const candidates = pool.loadUnseenLinks(
    sourceIds,
    nowMs - UNSEEN_PROBE_AFTER_MS,
    UNSEEN_PROBE_LIMIT * 5,
  );
  const due = candidates
    .filter((link) => nowMs - (askedAt.get(link.id) ?? 0) >= UNSEEN_REPROBE_MS)
    .slice(0, UNSEEN_PROBE_LIMIT);
  if (due.length === 0) return EMPTY;
  due.forEach((link) => askedAt.set(link.id, nowMs));
  const { census, goneVacancyIds, openVacancyIds } = await probeVacancyLinks(due, probe, {
    sample: due.length,
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
