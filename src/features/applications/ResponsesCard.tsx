import { useState } from 'react';
import {
  ArrowClockwise,
  DotsThreeVertical,
  FileText,
  Warning,
} from '@phosphor-icons/react';
import type { ApplicationStage } from '../../../shared/applicationStage';
import { SKIP_REASONS, type SkipReasonId } from '../../../shared/skipReasons';
import type { ApplicationView } from './applicationsApi';
import { waitingLabel } from './waitingLabel';

interface ResponsesCardProps {
  readonly application: ApplicationView;
  readonly failed: boolean;
  readonly conflicted: boolean;
  readonly onRetry: () => void;
  readonly onSaveNote: (notes: string) => void;
  readonly onSkip: (reasonId: SkipReasonId) => void;
}

/**
 * One card of the tracker board (mockup `.card`, B248/B251 S3). The stage
 * lives in the card menu, not on the face — the mockup's face shows role,
 * company, materials and the next step only (B251 S4 acceptance review);
 * stage change gets its own affordance in the next slice.
 */
export function ResponsesCard({
  application,
  failed,
  conflicted,
  onRetry,
  onSaveNote,
  onSkip,
}: ResponsesCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const label = waitingLabel({
    stage: application.stage,
    whoseTurn: application.whoseTurn,
    hasMaterials: application.materials.coverLetter || application.materials.resume,
    followUp: application.followUp,
    nearestInterviewNeedsPrep:
      application.nearestInterview !== null && application.nearestInterview.prepStatus !== 'ready',
    closedReason: application.closedReason,
  });

  return (
    <article
      className={`career-responses-card${label.on === 'you' ? ' is-your-turn' : ''}`}
      data-cluster={application.clusterId ?? ''}
    >
      <div className="career-responses-card-role">{application.vacancy?.title ?? 'Без названия'}</div>
      <div className="career-responses-card-company">
        {application.vacancy?.companyHidden
          ? 'компания скрыта'
          : application.vacancy?.company || 'компания не указана'}
      </div>
      <MaterialsBadge materials={application.materials} />
      <CardAlerts failed={failed} conflicted={conflicted} onRetry={onRetry} />
      <CardFooter
        application={application}
        labelText={label.text}
        labelOn={label.on}
        menuOpen={menuOpen}
        onToggleMenu={() => setMenuOpen((open) => !open)}
        onSaveNote={(notes) => {
          onSaveNote(notes);
          setMenuOpen(false);
        }}
        onSkip={(reasonId) => {
          onSkip(reasonId);
          setMenuOpen(false);
        }}
      />
    </article>
  );
}

interface CardFooterProps {
  application: ApplicationView;
  labelText: string;
  labelOn: 'you' | 'them' | null;
  menuOpen: boolean;
  onToggleMenu: () => void;
  onSaveNote: (notes: string) => void;
  onSkip: (reasonId: SkipReasonId) => void;
}

function CardFooter({
  application,
  labelText,
  labelOn,
  menuOpen,
  onToggleMenu,
  onSaveNote,
  onSkip,
}: CardFooterProps) {
  return (
    <div className="career-responses-card-footer">
      <span className={`career-responses-waiting ${labelOn ? `is-on-${labelOn}` : 'is-closed'}`}>
        {labelText}
      </span>
      <div className="career-responses-menu-wrap">
        <button type="button" aria-label="Действия с карточкой" onClick={onToggleMenu}>
          <DotsThreeVertical size={16} />
        </button>
        {menuOpen ? (
          <CardMenu application={application} onSaveNote={onSaveNote} onSkip={onSkip} />
        ) : null}
      </div>
    </div>
  );
}

function MaterialsBadge({ hasMaterials }: { hasMaterials: boolean }) {
  return (
    <div className="career-responses-card-materials">
      {hasMaterials ? <FileText size={12} /> : <Warning size={12} />}
      {hasMaterials ? 'Материалы на карточке' : 'Письмо не собрано'}
    </div>
  );
}

function CardAlerts({
  failed,
  conflicted,
  onRetry,
}: {
  failed: boolean;
  conflicted: boolean;
  onRetry: () => void;
}) {
  return (
    <>
      {failed ? (
        <p className="career-responses-card-failed" role="alert">
          Этап не сохранился.{' '}
          <button type="button" onClick={onRetry}>
            <ArrowClockwise size={12} /> Повторить
          </button>
        </p>
      ) : null}
      {conflicted ? (
        <p className="career-responses-card-failed" role="alert">
          Карточку изменили на другом устройстве. Обновите список.
        </p>
      ) : null}
    </>
  );
}

function StageChangeControl({
  stage,
  onChangeStage,
}: {
  stage: ApplicationStage;
  onChangeStage: (stage: ApplicationStage, occurredAt: string) => void;
}) {
  const [nextStage, setNextStage] = useState<ApplicationStage>(stage);
  const [occurredAt, setOccurredAt] = useState(todayIsoDate());
  const dirty = nextStage !== stage;
  return (
    <div className="career-responses-stage-control">
      <label>
        Этап
        <select
          value={nextStage}
          onChange={(event) => setNextStage(event.target.value as ApplicationStage)}
        >
          {APPLICATION_STAGES.map((value) => (
            <option key={value} value={value}>
              {STAGE_LABEL[value]}
            </option>
          ))}
        </select>
      </label>
      <label>
        Дата
        <input
          type="date"
          value={occurredAt}
          onChange={(event) => setOccurredAt(event.target.value)}
        />
      </label>
      {dirty ? (
        <button
          type="button"
          onClick={() => onChangeStage(nextStage, `${occurredAt}T00:00:00.000Z`)}
        >
          Сохранить этап
        </button>
      ) : null}
    </div>
  );
}

function CardMenu({
  application,
  onSaveNote,
  onSkip,
}: {
  application: ApplicationView;
  onSaveNote: (notes: string) => void;
  onSkip: (reasonId: SkipReasonId) => void;
}) {
  const [noteDraft, setNoteDraft] = useState(application.notes ?? '');
  const [skipping, setSkipping] = useState(false);
  const canSkip = application.stage === 'saved' && Boolean(application.clusterId);

  return (
    <div className="career-responses-card-menu">
      {application.vacancy?.url ? (
        <a href={application.vacancy.url} target="_blank" rel="noreferrer">
          Открыть карточку вакансии
        </a>
      ) : null}
      <label className="career-responses-note-field">
        Заметка
        <textarea
          value={noteDraft}
          onChange={(event) => setNoteDraft(event.target.value)}
          onBlur={() => onSaveNote(noteDraft)}
        />
      </label>
      {canSkip ? (
        <button type="button" onClick={() => setSkipping(true)}>
          Пропустить с причиной
        </button>
      ) : null}
      {skipping ? (
        <ul className="career-responses-reason-list">
          {SKIP_REASONS.map((reason) => (
            <li key={reason.id}>
              <button type="button" onClick={() => onSkip(reason.id)}>
                {reason.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
