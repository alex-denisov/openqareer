import { ArrowsClockwise, CheckCircle, Circle, CircleNotch } from '@phosphor-icons/react';
import {
  linkedinImportProgressView,
  useLinkedInImportProgress,
  type LinkedInImportProgressView,
} from '../connections/linkedinImportProgress';

/** Live LinkedIn walk: which sections are read, shown only while the walk is running. */
export function ProfileImportLive({ onReimport }: { readonly onReimport?: () => void } = {}) {
  const view = linkedinImportProgressView(useLinkedInImportProgress());
  return view ? <ImportLiveBlock view={view} onReimport={onReimport} /> : null;
}

interface ImportLiveProps {
  readonly view: LinkedInImportProgressView;
  readonly onReimport?: () => void;
}

function ImportLiveHeader({ view, onReimport }: ImportLiveProps) {
  return (
    <div className="career-profile-screen-import-live-header">
      <span className="career-profile-screen-import-live-title">
        <CircleNotch size="1em" aria-hidden="true" />
        LinkedIn: читаем разделы,{' '}
        <span className="career-profile-screen-numeric">{view.readCount}</span> из{' '}
        <span className="career-profile-screen-numeric">{view.total}</span>
      </span>
      {onReimport ? (
        <button
          type="button"
          className="career-secondary-button career-btn-sm"
          onClick={onReimport}
        >
          <ArrowsClockwise size="1em" aria-hidden="true" />
          Импортировать заново
        </button>
      ) : null}
    </div>
  );
}

export function ImportLiveBlock({ view, onReimport }: ImportLiveProps) {
  const percent = view.total ? Math.round((view.readCount / view.total) * 100) : 0;
  const activeIndex = view.stages.findIndex((stage) => !stage.done);
  return (
    <div className="career-profile-screen-import-live" role="status">
      <ImportLiveHeader view={view} onReimport={onReimport} />
      <progress
        className="career-profile-screen-import-live-bar"
        max={100}
        value={percent}
        aria-label={`Прочитано разделов: ${view.readCount} из ${view.total}, ${percent} %`}
      />
      <ul className="career-profile-screen-import-live-list" aria-label="Что импортируется">
        {view.stages.map((stage, index) => (
          <li key={stage.key} className={stage.done ? 'is-done' : undefined}>
            {stage.done ? (
              <CheckCircle size={14} aria-hidden="true" />
            ) : index === activeIndex ? (
              <CircleNotch size={14} aria-hidden="true" />
            ) : (
              <Circle size={14} aria-hidden="true" />
            )}
            {stage.label}
            <span className="career-sr-only">{stage.done ? ', прочитано' : ', ожидает'}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
