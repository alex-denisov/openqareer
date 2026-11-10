/**
 * B622: места в волне опроса по ярусам. До 09.11 волна брала 12 первых по
 * ярусу, и сотни каналов компаний (ярус 1) не пускали агрегаторы (ярус 3) —
 * общий поиск LinkedIn не опрашивался с 11:01 UTC. Теперь у каждого яруса
 * своя квота, несъеденные места отдаются по общему порядку.
 */
export type ChannelTier = 1 | 2 | 3;

export const WAVE_TIER_QUOTA: Readonly<Record<ChannelTier, number>> = { 1: 6, 2: 3, 3: 3 };

export function pickWave<T>(
  sorted: readonly T[],
  limit: number,
  tierOf: (item: T) => ChannelTier,
  quota: Readonly<Record<ChannelTier, number>> = WAVE_TIER_QUOTA,
): T[] {
  const used: Record<ChannelTier, number> = { 1: 0, 2: 0, 3: 0 };
  const first = sorted.filter((item) => {
    const tier = tierOf(item);
    if (used[tier] >= quota[tier]) return false;
    used[tier] += 1;
    return true;
  });
  const chosen = new Set(first.slice(0, limit));
  const rest = sorted.filter((item) => !chosen.has(item)).slice(0, limit - chosen.size);
  return sorted.filter((item) => chosen.has(item) || rest.includes(item));
}

/**
 * B628: каналы компаний (ярус 1 — свой сайт, затем ATS) идут отдельной
 * полосой волны. Шесть мест на ~2 000 каналов давали обход за сутки; теперь
 * полоса берёт до COMPANY_LANE_LIMIT каналов, но не больше
 * COMPANY_LANE_PER_HOST на один хост (все доски Greenhouse — один API).
 */
export const COMPANY_LANE_LIMIT = 96;
export const COMPANY_LANE_PER_HOST = 3;
export const COMPANY_LANE_CONCURRENCY = 24;
/**
 * B628: публичный JSON-API сервиса (все доски Greenhouse — один хост) держит
 * десятки запросов; при 3 на хост сервис получал 36 опросов в час.
 */
export const ATS_SERVICE_PER_HOST = 16;
const ATS_API_HOST =
  /(?:^|\.)(?:greenhouse\.io|lever\.co|ashbyhq\.com|workable\.com|smartrecruiters\.com|recruitee\.com|personio\.(?:de|com)|pinpointhq\.com|breezy\.hr|bamboohr\.com|teamtailor\.com|myworkdayjobs\.com)$/;

export function companyLanePerHost(host: string): number {
  return ATS_API_HOST.test(host) ? ATS_SERVICE_PER_HOST : COMPANY_LANE_PER_HOST;
}
/** Потолок ожидания одного канала в полосе; сам опрос не прерывается. */
export const COMPANY_LANE_SOURCE_TIMEOUT_MS = 120_000;

export function pickCompanyLane<T>(
  sorted: readonly T[],
  limit: number,
  perHost: number | ((host: string) => number),
  hostOf: (item: T) => string,
): T[] {
  const limitOf = typeof perHost === 'number' ? () => perHost : perHost;
  const perHostUsed = new Map<string, number>();
  const picked: T[] = [];
  for (const item of sorted) {
    if (picked.length >= limit) break;
    const host = hostOf(item);
    const used = perHostUsed.get(host) ?? 0;
    if (used >= limitOf(host)) continue;
    perHostUsed.set(host, used + 1);
    picked.push(item);
  }
  return picked;
}
