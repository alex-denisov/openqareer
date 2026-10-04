import type { ApplicationView } from './applicationsApi';
import { ArchivedResponseCard } from './ArchivedResponseCard';

interface ArchivedResponsesListProps {
  readonly id: string;
  readonly expanded: boolean;
  readonly applications: readonly ApplicationView[];
  readonly visibleCount: number;
  readonly onShowMore: () => void;
  readonly onRestore: (application: ApplicationView) => Promise<unknown>;
}

export function ArchivedResponsesList({
  id,
  expanded,
  applications,
  visibleCount,
  onShowMore,
  onRestore,
}: ArchivedResponsesListProps) {
  return (
    <div id={id} className="career-responses-archive-content" role="region" hidden={!expanded}>
      <ul className="career-responses-archive-list">
        {applications.slice(0, visibleCount).map((application) => (
          <li key={application.id}>
            <ArchivedResponseCard application={application} onRestore={onRestore} />
          </li>
        ))}
      </ul>
      {visibleCount < applications.length ? (
        <button
          type="button"
          className="career-btn career-btn-secondary career-btn-sm career-responses-archive-more"
          onClick={onShowMore}
        >
          Показать ещё
        </button>
      ) : null}
    </div>
  );
}
