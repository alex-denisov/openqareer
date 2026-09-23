import { regionOfVacancy } from '../../../server/vacancies/vacancyGeography';
import { normalizeCandidateRegions, type CandidateRegion } from '../workspace/candidateRegions';

export interface OpenToWorkRegionMapping {
  /** LinkedIn location strings resolved to the candidate-region catalogue. */
  readonly matched: readonly CandidateRegion[];
  /** Location strings the existing geography dictionary does not know, e.g.
   * "Remote (EU)" — never dropped, shown for a manual pick instead. */
  readonly unmatched: readonly string[];
}

/**
 * Maps LinkedIn's free-text "Open to work" locations onto the seven-region
 * catalogue the wizard and Resume Studio's region step already use, reusing
 * the same country/city dictionary vacancy geography matches against
 * (`vacancyGeography.ts`, PRB-040) rather than inventing a second one. A
 * string the dictionary does not recognise is not a region OpenQareer can
 * silently pick for the candidate, so it is returned rather than discarded.
 */
export function mapOpenToWorkLocations(locations: readonly string[]): OpenToWorkRegionMapping {
  const matched = new Set<CandidateRegion>();
  const unmatched: string[] = [];
  for (const raw of locations) {
    const location = raw.trim();
    if (!location) continue;
    const region = regionOfVacancy({ location });
    if (region) matched.add(region);
    else unmatched.push(location);
  }
  return { matched: normalizeCandidateRegions([...matched]), unmatched };
}
