import { useState } from 'react';
import type { ApplicationView } from './applicationsApi';
import { apiErrorMessage } from './applicationListOps';
import { archiveReasonLabel } from './archiveReasonLabel';

interface ArchivedResponseCardProps {
  readonly application: ApplicationView;
  readonly onRestore: (application: ApplicationView) => Promise<unknown>;
}

export function ArchivedResponseCard({ application, onRestore }: ArchivedResponseCardProps) {
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState<string>();
  const company = application.vacancy?.companyHidden
    ? 'Компания скрыта'
    : application.vacancy?.company || 'Компания не указана';

  const restore = async () => {
    setRestoring(true);
    setError(undefined);
    try {
      await onRestore(application);
    } catch (reason: unknown) {
      setError(apiErrorMessage(reason, 'Не удалось вернуть отклик в работу. Попробуйте ещё раз.'));
    } finally {
      setRestoring(false);
    }
  };

  return (
    <article className="career-responses-card career-responses-archive-card">
      <div className="career-responses-card-body">
        <div className="career-responses-card-role">
          {application.vacancy?.title ?? 'Без названия'}
        </div>
        <div className="career-responses-card-company">{company}</div>
      </div>
      <p className="career-responses-archive-reason">
        {archiveReasonLabel(application.archiveReason, application.archiveStaleDays)}
      </p>
      {error ? (
        <p className="career-responses-card-failed" role="alert">
          {error}
        </p>
      ) : null}
      <button
        type="button"
        className="career-btn career-btn-secondary career-btn-sm"
        disabled={restoring}
        aria-busy={restoring}
        onClick={() => void restore()}
      >
        {restoring ? 'Возвращаем…' : 'Вернуть в работу'}
      </button>
    </article>
  );
}
