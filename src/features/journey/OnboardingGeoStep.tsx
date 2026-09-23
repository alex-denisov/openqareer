import {
  CANDIDATE_REGION_CATALOGUE,
  type CandidateRegion,
} from '../workspace/candidateRegions';

/**
 * The mockup's format-row ("Полная занятость / Контракт-interim /
 * Консультирование") has no field of its own in `WorkspaceInput` yet; it
 * rides on the existing `constraints` free-text field alongside the other
 * conditions, one value at a time (single-select, matching the mockup).
 */
export const ONBOARDING_FORMAT_OPTIONS = [
  'Полная занятость',
  'Контракт / interim',
  'Консультирование',
] as const;

export type OnboardingFormat = (typeof ONBOARDING_FORMAT_OPTIONS)[number];

interface OnboardingGeoStepProps {
  readonly regions: readonly CandidateRegion[];
  /** A region the wizard already knows from an import, e.g. LinkedIn. */
  readonly prefilledRegion?: CandidateRegion;
  readonly format: OnboardingFormat;
  readonly onToggleRegion: (region: CandidateRegion) => void;
  readonly onChangeFormat: (format: OnboardingFormat) => void;
}

/**
 * Step 5, "География и формат" (onboarding.html). The mockup's own chips
 * name cities ("Дубай, ОАЭ"); the product only ever asks region-level
 * geography (`candidateRegions.ts`, owner decision B158), so the seven real
 * regions stand in for the mockup's illustrative city list.
 */
export function OnboardingGeoStep(props: OnboardingGeoStepProps) {
  return (
    <div className="career-onboarding-geo">
      <div className="career-onboarding-geo-grid">
        {CANDIDATE_REGION_CATALOGUE.map((region) => {
          const selected = props.regions.includes(region.id);
          const fromImport = props.prefilledRegion === region.id;
          return (
            <button
              key={region.id}
              type="button"
              className={`tag ${selected ? 'is-selected' : ''}`}
              aria-pressed={selected}
              onClick={() => props.onToggleRegion(region.id)}
            >
              {region.label}
              {fromImport ? ' · из LinkedIn' : ''}
            </button>
          );
        })}
      </div>
      <div className="career-onboarding-format-row" role="radiogroup" aria-label="Формат работы">
        {ONBOARDING_FORMAT_OPTIONS.map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={props.format === option}
            className={`tag ${props.format === option ? 'is-selected' : ''}`}
            onClick={() => props.onChangeFormat(option)}
          >
            {option}
          </button>
        ))}
      </div>
    </div>
  );
}
