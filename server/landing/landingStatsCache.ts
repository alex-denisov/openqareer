/**
 * B535: the landing's pool numbers and featured vacancies, held in memory.
 *
 * The HTTP path only reads this value; it never queries the pool (B308/INC:
 * reading the pool on a request blocked the event loop). A background refresh
 * replaces the value; until the first refresh succeeds the owner-approved
 * reading of 2026-10-20 is served.
 */
import { LANDING_STATS_SNAPSHOT, type LandingStats } from '../../shared/landingStats';

let current: LandingStats = LANDING_STATS_SNAPSHOT;

export function getLandingStats(): LandingStats {
  return current;
}

export function setLandingStats(next: LandingStats): void {
  if (next.activeCount <= 0 || next.vacancies.length === 0) return;
  current = next;
}

/** Test seam: back to the approved snapshot. */
export function resetLandingStats(): void {
  current = LANDING_STATS_SNAPSHOT;
}
