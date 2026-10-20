import { LANDING_STATS_SCRIPT_ID, type LandingStats } from '../../../shared/landingStats';

/**
 * The server writes live pool stats into the prerendered landing. The script
 * lives inside `#root`, and `createRoot` wipes `#root` before the lazily loaded
 * landing reads it, so the page used to fall back to the build-time snapshot
 * and the hero swapped its vacancies a moment after load. `main.tsx` captures
 * the stats before mounting.
 */
let captured: LandingStats | null = null;

export function captureEmbeddedLandingStats(doc: Document = document): void {
  const text = doc.getElementById(LANDING_STATS_SCRIPT_ID)?.textContent;
  if (!text) return;
  try {
    const parsed = JSON.parse(text) as LandingStats;
    if (Array.isArray(parsed.vacancies)) captured = parsed;
  } catch {
    // Tokens left unreplaced (local dev) are not JSON: keep the snapshot.
  }
}

export function capturedLandingStats(): LandingStats | null {
  return captured;
}
