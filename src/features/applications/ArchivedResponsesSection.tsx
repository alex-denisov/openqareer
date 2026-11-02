import { useEffect, useId, useState } from 'react';
import { archiveReasonLabel } from './archiveReasonLabel';
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
    <section className="career-responses-archive" aria-label="Закрытые отклики">
      <p className="career-responses-archive-line">
        Закрыто {applications.length}: {closedBreakdown(applications)}.{' '}
        <button
          ref={toggleRef}
          type="button"
          className="career-responses-archive-toggle"
          aria-expanded={expanded}
          aria-controls={listId}
          onClick={() => setExpanded((open) => !open)}
        >
          Показать закрытые
        </button>
        . В колонках сверху карточки с действием, дальше по сроку шага.
      </p>
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

/** «отказ работодателя 18, вы перенесли в архив 11, …» from the recorded reasons. */
function closedBreakdown(applications: readonly ApplicationView[]): string {
  const counts = new Map<string, number>();
  for (const application of applications) {
    const label = archiveReasonLabel(application.archiveReason, application.archiveStaleDays);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(
      ([label, count]) => `${label.charAt(0).toLocaleLowerCase('ru-RU')}${label.slice(1)} ${count}`,
    )
    .join(', ');
}
