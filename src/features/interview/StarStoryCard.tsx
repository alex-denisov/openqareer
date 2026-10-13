import {
  ArrowUpRight,
  CheckCircle,
  FileText,
  PencilSimple,
  WarningCircle,
} from '@phosphor-icons/react';
import type { StarField, StarStoryView } from '../../../shared/starStories';

const FIELD_LABELS: Readonly<Record<StarField, string>> = {
  situation: 'Ситуация',
  task: 'Задача',
  action: 'Действие',
  result: 'Результат',
};

export function StarStoryCard({
  story,
  onEdit,
}: {
  readonly story: StarStoryView;
  readonly onEdit: () => void;
}) {
  const confirmed = story.confidence === 'confirmed';
  return (
    <article className="career-star-story-card">
      <header className="career-star-story-card-header">
        <div>
          <span
            className={`career-star-story-status ${confirmed ? 'is-confirmed' : 'is-unconfirmed'}`}
          >
            {confirmed ? (
              <CheckCircle size={16} aria-hidden="true" />
            ) : (
              <WarningCircle size={16} aria-hidden="true" />
            )}
            {confirmed ? 'Подтверждено фактом' : 'Не подтверждено'}
          </span>
          <h3>{story.title}</h3>
        </div>
        <button
          type="button"
          className="career-btn career-btn-secondary career-star-story-edit"
          onClick={onEdit}
        >
          <PencilSimple size={16} aria-hidden="true" /> Править STAR-историю
        </button>
      </header>
      <StarStoryFields fields={story.fields} />
      <StarStorySources story={story} />
    </article>
  );
}

function StarStoryFields({ fields }: { readonly fields: StarStoryView['fields'] }) {
  return (
    <dl className="career-star-story-fields">
      {(Object.keys(FIELD_LABELS) as StarField[]).map((field) => (
        <div key={field}>
          <dt>{FIELD_LABELS[field]}</dt>
          <dd>{fields[field] || 'Не заполнено'}</dd>
        </div>
      ))}
    </dl>
  );
}

function StarStorySources({ story }: { readonly story: StarStoryView }) {
  if (story.sourceFacts.length === 0) {
    return (
      <p className="career-star-story-unconfirmed-note">
        У истории пока нет подтверждённого факта-источника.
      </p>
    );
  }
  return (
    <div className="career-star-story-sources" aria-label="Факты-источники">
      <h4>Факты профиля</h4>
      {story.sourceFacts.map((fact) => (
        <div className="career-star-story-source" key={fact.id}>
          {fact.unavailable ? (
            <p role="status">Факт больше недоступен: {fact.id}</p>
          ) : (
            <SourceFactLink storyId={story.id} factId={fact.id} statement={fact.statement} />
          )}
        </div>
      ))}
    </div>
  );
}

function SourceFactLink({
  storyId,
  factId,
  statement,
}: {
  storyId: string;
  factId: string;
  statement: string;
}) {
  const targetId = `star-story-source-${storyId}-${factId}`;
  return (
    <>
      <a className="career-star-story-source-link" href={`#${targetId}`}>
        <FileText size={15} aria-hidden="true" /> Источник: {statement}
        <ArrowUpRight size={14} aria-hidden="true" />
      </a>
      <p className="career-star-story-source-text" id={targetId} tabIndex={-1}>
        {statement}
      </p>
    </>
  );
}
