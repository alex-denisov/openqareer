/**
 * Where the candidate is actually looking for work.
 *
 * The wizard used to ask this as one binary — «Россия» or «Международный
 * рынок» — and the owner rejected that model: relocation splits by region
 * (`EU`, `MENA`, `US`, …), not by country and not by a single flag (B158).
 * A candidate may look in several regions at once, or in none yet.
 *
 * The catalogue deliberately carries only the region's name. Resume language,
 * photo expectations, work-authorisation rules and the platform that serves
 * each region are still open items on B158 — the first two wait on the career
 * expert's research, the third on the dual-profile slice. Writing any of them
 * here now would ship a guess as career advice.
 */

export const CANDIDATE_REGIONS = [
  'ru',
  'eu',
  'uk',
  'us',
  'mena',
  'apac',
  'latam',
] as const;

export type CandidateRegion = (typeof CANDIDATE_REGIONS)[number];

export interface CandidateRegionProfile {
  readonly id: CandidateRegion;
  readonly label: string;
}

export const CANDIDATE_REGION_CATALOGUE: readonly CandidateRegionProfile[] = [
  { id: 'ru', label: 'Россия' },
  { id: 'eu', label: 'Европа' },
  { id: 'uk', label: 'Великобритания' },
  { id: 'us', label: 'США и Канада' },
  { id: 'mena', label: 'Ближний Восток' },
  { id: 'apac', label: 'Азия и Океания' },
  { id: 'latam', label: 'Латинская Америка' },
];

export function isCandidateRegion(value: unknown): value is CandidateRegion {
  return (
    typeof value === 'string' &&
    (CANDIDATE_REGIONS as readonly string[]).includes(value)
  );
}

export function isCandidateRegionList(
  value: unknown,
): value is readonly CandidateRegion[] {
  return Array.isArray(value) && value.every(isCandidateRegion);
}

/**
 * Keeps a stored list in catalogue order, drops duplicates and drops anything
 * that is not a region — a persisted value is data from a previous release, not
 * a promise about today's catalogue.
 */
export function normalizeCandidateRegions(
  value: unknown,
): readonly CandidateRegion[] {
  if (!Array.isArray(value)) return [];
  const chosen = new Set(value.filter(isCandidateRegion));
  return CANDIDATE_REGIONS.filter((region) => chosen.has(region));
}

/**
 * Upgrades the pre-B158 answer.
 *
 * `ru` named exactly one region. `international` named none — it said only
 * "not Russia". Expanding it into a region set would invent an answer the
 * candidate never gave, so it migrates to an empty list, which the interface
 * shows honestly and asks about.
 */
export function regionsFromLegacyMarket(
  market: unknown,
): readonly CandidateRegion[] {
  return market === 'ru' ? ['ru'] : [];
}

export function candidateRegionLabel(region: CandidateRegion): string {
  return CANDIDATE_REGION_CATALOGUE.find((entry) => entry.id === region)!.label;
}

export function candidateRegionLabels(
  regions: readonly CandidateRegion[],
): readonly string[] {
  return normalizeCandidateRegions(regions).map(candidateRegionLabel);
}
