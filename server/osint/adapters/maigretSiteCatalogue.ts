import sourceSites from './maigretSites.json';
import type { UsernamePresenceSite } from './usernamePresenceAdapter';

export interface MaigretSite extends UsernamePresenceSite {
  readonly adapterId: 'sherlock' | 'maigret';
  readonly tags: readonly string[];
  readonly alexaRank?: number;
}

export const MAIGRET_SITES: readonly MaigretSite[] = sourceSites as unknown as readonly MaigretSite[];

const sitesByName = new Map(MAIGRET_SITES.map((site) => [site.name, site]));

export function getCuratedMaigretSite(name: string): MaigretSite | undefined {
  return sitesByName.get(name);
}

export function isCuratedMaigretSite(site: UsernamePresenceSite): boolean {
  const curated = sitesByName.get(site.name);
  return Boolean(
    curated &&
      curated.url === site.url &&
      curated.checkType === site.checkType &&
      JSON.stringify(curated.presenseStrs ?? []) === JSON.stringify(site.presenseStrs ?? []) &&
      JSON.stringify(curated.absenceStrs ?? []) === JSON.stringify(site.absenceStrs ?? []),
  );
}
