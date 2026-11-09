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
