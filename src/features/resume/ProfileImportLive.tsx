import {
  ArrowsClockwise,
  CheckCircle,
  Circle,
  CircleNotch,
  WarningCircle,
} from '@phosphor-icons/react';
import type { ImportWalk, ImportWalkSectionStatus } from '../coach/coachApi';
import {
  linkedinImportProgressView,
  linkedinStageLabel,
  useLinkedInImportProgress,
  type LinkedInImportProgressView,
} from '../connections/linkedinImportProgress';
import { walkHeadline, walkReadCount } from './profileProvenance';

interface WalkBandView {
  readonly headline: string;
  readonly running: boolean;
  readonly readCount: number;
  readonly total: number;
  readonly stages: readonly {
    readonly key: string;
    readonly label: string;
    readonly status: ImportWalkSectionStatus;
  }[];
}

/**
 * Макет 2: «LinkedIn: читаем разделы, 3 из 7» with the section chips and
 * «Импортировать заново» inside the band. The live walk of this window wins;
 * otherwise the last walk the server kept (B541), so a reload does not hide it.
 */
export function ProfileImportLive({
  onReimport,
  storedWalk,
}: { readonly onReimport?: () => void; readonly storedWalk?: ImportWalk } = {}) {
  const live = linkedinImportProgressView(useLinkedInImportProgress());
  const view = live ? liveBand(live) : storedWalk ? storedBand(storedWalk) : null;
  return view ? <WalkBand view={view} onReimport={onReimport} /> : null;
}

function liveBand(view: LinkedInImportProgressView): WalkBandView {
  return {
    headline: `LinkedIn: читаем разделы, ${view.readCount} из ${view.total}`,
    running: true,
    readCount: view.readCount,
    total: view.total,
    stages: view.stages.map((stage) => ({
      key: stage.key,
      label: stage.label,
      status: stage.done ? 'read' : 'pending',
    })),
  };
}

function storedBand(walk: ImportWalk): WalkBandView {
  return {
    headline: walkHeadline(walk),
    running: walk.state === 'running',
    readCount: walkReadCount(walk),
    total: walk.sections.length,
    stages: walk.sections.map((section) => ({
      key: section.key,
      label: linkedinStageLabel(section.key),
      status: section.status,
    })),
  };
}

/** Kept for callers that render a live view directly. */
export function ImportLiveBlock({
  view,
  onReimport,
}: {
  readonly view: LinkedInImportProgressView;
  readonly onReimport?: () => void;
}) {
  return <WalkBand view={liveBand(view)} onReimport={onReimport} />;
}

const STATUS_TEXT: Record<ImportWalkSectionStatus, string> = {
  read: ', прочитано',
  pending: ', ожидает',
  failed: ', не прочитано',
};

function StageIcon({
  status,
  active,
}: {
  readonly status: ImportWalkSectionStatus;
  readonly active: boolean;
}) {
  if (status === 'read') return <CheckCircle size={14} aria-hidden="true" />;
  if (status === 'failed') return <WarningCircle size={14} aria-hidden="true" />;
  return active ? (
    <CircleNotch size={14} aria-hidden="true" />
  ) : (
    <Circle size={14} aria-hidden="true" />
  );
}

function WalkBandHeader({
  view,
  onReimport,
}: {
  readonly view: WalkBandView;
  readonly onReimport?: () => void;
}) {
  return (
    <div className="career-profile-screen-import-live-header">
      <span className="career-profile-screen-import-live-title">
        {view.running ? (
          <CircleNotch size="1em" aria-hidden="true" />
        ) : (
          <CheckCircle size="1em" aria-hidden="true" />
        )}
        {view.headline}
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

function WalkBand({
  view,
  onReimport,
}: {
  readonly view: WalkBandView;
  readonly onReimport?: () => void;
}) {
  const percent = view.total ? Math.round((view.readCount / view.total) * 100) : 0;
  const activeIndex = view.running
    ? view.stages.findIndex((stage) => stage.status === 'pending')
    : -1;
  return (
    <div className="career-profile-screen-import-live" role="status">
      <WalkBandHeader view={view} onReimport={onReimport} />
      <progress
        className="career-profile-screen-import-live-bar"
        max={100}
        value={percent}
        aria-label={`Прочитано разделов: ${view.readCount} из ${view.total}, ${percent} %`}
      />
      <ul className="career-profile-screen-import-live-list" aria-label="Что импортируется">
        {view.stages.map((stage, index) => (
          <li
            key={stage.key}
            className={
              stage.status === 'read'
                ? 'is-done'
                : stage.status === 'failed'
                  ? 'is-failed'
                  : undefined
            }
          >
            <StageIcon status={stage.status} active={index === activeIndex} />
            {stage.label}
            <span className="career-sr-only">{STATUS_TEXT[stage.status]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
