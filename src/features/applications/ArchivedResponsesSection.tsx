import { useEffect, useId, useState } from 'react';
import { Archive } from '@phosphor-icons/react';
import type { ApplicationView } from './applicationsApi';
import { ArchivedResponsesList } from './ArchivedResponsesList';
import { useArchivedResponsesNavigation } from './useArchivedResponsesNavigation';

interface ArchivedResponsesSectionProps {
  readonly applications: readonly ApplicationView[];
  readonly initiallyOpen?: boolean;
  readonly onRestore: (application: ApplicationView) => Promise<unknown>;
}

export function ArchivedResponsesSection({
  applications,
  initiallyOpen = false,
  onRestore,
}: ArchivedResponsesSectionProps) {
  const listId = useId();
  const [expanded, setExpanded] = useState(initiallyOpen);
  const [visibleCount, setVisibleCount] = useState(20);
  const toggleRef = useArchivedResponsesNavigation(
    initiallyOpen,
    applications.length > 0,
    setExpanded,
  );

  useEffect(() => setVisibleCount(20), [applications.length]);
  if (applications.length === 0) return null;

  return (
    <section className="career-responses-archive" aria-label="Архив откликов">
      <button
        ref={toggleRef}
        type="button"
        className="career-btn career-btn-secondary career-btn-sm career-responses-archive-toggle"
        aria-expanded={expanded}
        aria-controls={listId}
        onClick={() => setExpanded((open) => !open)}
      >
        <Archive size={16} aria-hidden="true" />
        <span>Архив</span>
        <span className="career-responses-archive-count">· {applications.length}</span>
      </button>
      <ArchivedResponsesList
        id={listId}
        expanded={expanded}
        applications={applications}
        visibleCount={visibleCount}
        onShowMore={() => setVisibleCount((count) => count + 20)}
        onRestore={onRestore}
      />
    </section>
  );
}
