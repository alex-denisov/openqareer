import { useState, type ReactNode } from 'react';
import { CaretDown, MapPin } from '@phosphor-icons/react';
import { ProfileFactProvenance } from './ProfileProvenanceChip';
import type { groupExperienceByEmployer } from './profileGrouping';

/** Макет 2: первые два места развёрнуты, более старые — одной строкой. */
export const EXPANDED_PLACES = 2;

type PlaceGroup = ReturnType<typeof groupExperienceByEmployer>[number];

/**
 * An older place reads as one line until the candidate opens it; the choice
 * lives only in this render (not kept between reloads, as the ticket asks).
 */
export function CollapsiblePlace({
  group,
  collapsed: initiallyCollapsed,
  period,
  children,
}: {
  readonly group: PlaceGroup;
  readonly collapsed: boolean;
  readonly period: string;
  readonly children: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(initiallyCollapsed);
  if (!collapsed) return <>{children}</>;
  const employer = group.employer || 'Работодатель не указан';
  const latest = group.positions[0];
  return (
    <article className="career-profile-screen-place-compact">
      <div className="career-profile-screen-place-compact-copy">
        <b>{employer}</b>
        <p>{[latest?.title || 'Должность не указана', period].filter(Boolean).join(' · ')}</p>
        <div className="career-profile-screen-position-tags">
          {latest?.location ? (
            <span className="career-profile-screen-company-span">
              <MapPin size={14} aria-hidden="true" />
              {latest.location}
            </span>
          ) : null}
          <ProfileFactProvenance memoryId={latest?.chronologyMemoryId} />
        </div>
      </div>
      <button
        type="button"
        className="career-quiet-button"
        aria-expanded="false"
        aria-label={`Развернуть место: ${employer}`}
        onClick={() => setCollapsed(false)}
      >
        <CaretDown size={16} aria-hidden="true" />
        Развернуть
      </button>
    </article>
  );
}
