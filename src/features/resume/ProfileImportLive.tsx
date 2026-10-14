import { CheckCircle, Circle } from '@phosphor-icons/react';
import {
  linkedinImportProgressView,
  useLinkedInImportProgress,
  type LinkedInImportProgressView,
} from '../connections/linkedinImportProgress';

/** Live LinkedIn walk: which sections are read, shown only while the walk is running. */
export function ProfileImportLive() {
  const view = linkedinImportProgressView(useLinkedInImportProgress());
  return view ? <ImportLiveBlock view={view} /> : null;
}

export function ImportLiveBlock({ view }: { readonly view: LinkedInImportProgressView }) {
  const percent = Math.round((view.readCount / view.total) * 100);
  return (
    <div className="career-profile-screen-import-live" role="status">
      <span className="career-profile-screen-import-live-title">
        LinkedIn: читаем разделы,{' '}
        <span className="career-profile-screen-numeric">{view.readCount}</span> из{' '}
        <span className="career-profile-screen-numeric">{view.total}</span>
      </span>
      <progress
        className="career-profile-screen-import-live-bar"
        max={view.total}
        value={view.readCount}
        aria-label={`Прочитано разделов: ${view.readCount} из ${view.total}, ${percent} %`}
      />
      <ul className="career-profile-screen-import-live-list" aria-label="Что импортируется">
        {view.stages.map((stage) => (
          <li key={stage.key} className={stage.done ? 'is-done' : undefined}>
            {stage.done ? (
              <CheckCircle size={14} weight="fill" aria-hidden="true" />
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
