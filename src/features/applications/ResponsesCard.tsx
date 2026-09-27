import { useState } from 'react';
import { ArrowClockwise, DotsThreeVertical, FileText, Warning } from '@phosphor-icons/react';
import { APPLICATION_STAGES, type ApplicationStage } from '../../../shared/applicationStage';
import { SKIP_REASONS, type SkipReasonId } from '../../../shared/skipReasons';
import { InterviewPrepModal } from '../interview/InterviewPrepModal';
import type { ApplicationView } from './applicationsApi';
import { waitingLabel } from './waitingLabel';

const STAGE_LABEL: Record<ApplicationStage, string> = {
  saved: 'Хочу',
  applied: 'Откликнулся',
  responded: 'Ответ',
  interview: 'Интервью',
  offer: 'Оффер',
  rejected: 'Отказ',
  archived: 'Архив',
};

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

interface ResponsesCardProps {
  readonly application: ApplicationView;
  readonly failed: boolean;
  readonly conflicted: boolean;
  readonly onChangeStage: (stage: ApplicationStage, occurredAt: string) => void;
  readonly onScheduleInterview: (scheduledAt: string) => Promise<void>;
  readonly onRetry: () => void;
  readonly onSaveNote: (notes: string) => void;
  readonly onMarkFollowUpSent: () => Promise<void>;
  readonly onSkip: (reasonId: SkipReasonId) => void;
}

/**
 * One card of the tracker board (mockup `.card`, B248/B251 S3). The stage
 * lives in the card menu, not on the face — the mockup's face shows role,
 * company, materials and the next step only (B251 S4 acceptance review);
 * stage change gets its own affordance in the next slice.
 */
function waitingLabelFor(application: ApplicationView) {
  return waitingLabel({
    stage: application.stage,
    whoseTurn: application.whoseTurn,
    hasMaterials: application.materials.coverLetter || application.materials.resume,
    followUp: application.followUp,
    nearestInterviewNeedsPrep:
      application.nearestInterview !== null && application.nearestInterview.prepStatus !== 'ready',
    closedReason: application.closedReason,
  });
}

export function ResponsesCard({
  application,
  failed,
  conflicted,
  onChangeStage,
  onScheduleInterview,
  onRetry,
  onSaveNote,
  onMarkFollowUpSent,
  onSkip,
}: ResponsesCardProps) {
  const label = waitingLabelFor(application);

  return (
    <article
      className={`career-responses-card${label.on === 'you' ? ' is-your-turn' : ''}`}
      data-cluster={application.clusterId ?? ''}
    >
      <div className="career-responses-card-role">
        {application.vacancy?.title ?? 'Без названия'}
      </div>
      <div className="career-responses-card-company">
        {application.vacancy?.companyHidden
          ? 'компания скрыта'
          : application.vacancy?.company || 'компания не указана'}
      </div>
      <MaterialsBadge
        hasMaterials={application.materials.coverLetter || application.materials.resume}
      />
      <CardAlerts failed={failed} conflicted={conflicted} onRetry={onRetry} />
      {application.stage === 'interview' ? (
        <PrepareInterviewControl application={application} />
      ) : null}
      <CardFooter
        application={application}
        labelText={label.text}
        labelOn={label.on}
        onChangeStage={onChangeStage}
        onScheduleInterview={onScheduleInterview}
        onSaveNote={onSaveNote}
        onSkip={onSkip}
      />
      <FollowUpSentControl application={application} onMark={onMarkFollowUpSent} />
    </article>
  );
}

/** «Подготовиться» from a card already in the interview stage (B251 F5) opens
 * the same prep material «Сегодня» offers — no separate prep screen exists
 * yet (`docs/v1-release/tasks/codex/C47-b251-interview-path-from-card.md`). */
function PrepareInterviewControl({ application }: { application: ApplicationView }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="career-responses-prep-action">
      <button
        type="button"
        className="career-btn career-btn-primary career-btn-sm"
        onClick={() => setOpen(true)}
      >
        Подготовиться
      </button>
      <InterviewPrepModal
        isOpen={open}
        onClose={() => setOpen(false)}
        vacancy={{
          id: application.id,
          title: application.vacancy?.title ?? 'Без названия',
          company: application.vacancy?.companyHidden
            ? undefined
            : (application.vacancy?.company ?? undefined),
        }}
      />
    </div>
  );
}

function FollowUpSentControl({
  application,
  onMark,
}: {
  application: ApplicationView;
  onMark: () => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  if (
    application.stage !== 'applied' ||
    (application.followUp?.urgency !== 'due' &&
      application.followUp?.urgency !== 'overdue' &&
      application.followUp?.urgency !== 'stale')
  ) {
    return null;
  }

  return (
    <div className="career-responses-follow-up-action">
      {failed ? <span role="alert">Не удалось сохранить отметку.</span> : null}
      <button
        type="button"
        className="career-btn career-btn-secondary career-btn-sm"
        disabled={saving}
        onClick={() => {
          setSaving(true);
          setFailed(false);
          void onMark()
            .catch(() => setFailed(true))
            .finally(() => setSaving(false));
        }}
      >
        {saving ? 'Сохраняем…' : 'Отметить follow-up отправленным'}
      </button>
    </div>
  );
}

interface CardFooterProps {
  application: ApplicationView;
  labelText: string;
  labelOn: 'you' | 'them' | null;
  onChangeStage: (stage: ApplicationStage, occurredAt: string) => void;
  onScheduleInterview: (scheduledAt: string) => Promise<void>;
  onSaveNote: (notes: string) => void;
  onSkip: (reasonId: SkipReasonId) => void;
}

function CardFooter({
  application,
  labelText,
  labelOn,
  onChangeStage,
  onScheduleInterview,
  onSaveNote,
  onSkip,
}: CardFooterProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div className="career-responses-card-footer">
      <span className={`career-responses-waiting ${labelOn ? `is-on-${labelOn}` : 'is-closed'}`}>
        {labelText}
      </span>
      <div className="career-responses-menu-wrap">
        <button
          type="button"
          aria-label="Действия с карточкой"
          onClick={() => setMenuOpen((open) => !open)}
        >
          <DotsThreeVertical size={16} />
        </button>
        {menuOpen ? (
          <CardMenu
            application={application}
            onChangeStage={(stage, occurredAt) => {
              onChangeStage(stage, occurredAt);
              setMenuOpen(false);
            }}
            onScheduleInterview={(scheduledAt) => {
              setMenuOpen(false);
              return onScheduleInterview(scheduledAt);
            }}
            onSaveNote={(notes) => {
              onSaveNote(notes);
              setMenuOpen(false);
            }}
            onSkip={(reasonId) => {
              onSkip(reasonId);
              setMenuOpen(false);
            }}
          />
        ) : null}
      </div>
    </div>
  );
}

function MaterialsBadge({ hasMaterials }: { hasMaterials: boolean }) {
  return (
    <div className={`career-responses-card-materials${hasMaterials ? '' : ' is-missing'}`}>
      {hasMaterials ? <FileText size={12} /> : <Warning size={12} />}
      {hasMaterials ? 'Письмо · резюме' : 'Письмо не собрано'}
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
  onScheduleInterview,
}: {
  stage: ApplicationStage;
  onChangeStage: (stage: ApplicationStage, occurredAt: string) => void;
  onScheduleInterview: (scheduledAt: string) => Promise<void>;
}) {
  const [nextStage, setNextStage] = useState<ApplicationStage>(stage);
  const [occurredAt, setOccurredAt] = useState(todayIsoDate());
  const dirty = nextStage !== stage;
  const movingToInterview = nextStage === 'interview';
  return (
    <div className="career-responses-stage-control">
      <StageSelect value={nextStage} onChange={setNextStage} />
      <label>
        {movingToInterview ? 'Дата интервью' : 'Дата'}
        <input
          type="date"
          value={occurredAt}
          onChange={(event) => setOccurredAt(event.target.value)}
        />
      </label>
      {dirty ? (
        <button
          type="button"
          onClick={() =>
            saveStageChange({
              nextStage,
              occurredAt,
              movingToInterview,
              onChangeStage,
              onScheduleInterview,
            })
          }
        >
          Сохранить этап
        </button>
      ) : null}
    </div>
  );
}

function StageSelect({
  value,
  onChange,
}: {
  value: ApplicationStage;
  onChange: (stage: ApplicationStage) => void;
}) {
  return (
    <label>
      Этап
      <select value={value} onChange={(event) => onChange(event.target.value as ApplicationStage)}>
        {APPLICATION_STAGES.map((stageOption) => (
          <option key={stageOption} value={stageOption}>
            {STAGE_LABEL[stageOption]}
          </option>
        ))}
      </select>
    </label>
  );
}

function saveStageChange({
  nextStage,
  occurredAt,
  movingToInterview,
  onChangeStage,
  onScheduleInterview,
}: {
  nextStage: ApplicationStage;
  occurredAt: string;
  movingToInterview: boolean;
  onChangeStage: (stage: ApplicationStage, occurredAt: string) => void;
  onScheduleInterview: (scheduledAt: string) => Promise<void>;
}) {
  const occurredAtIso = `${occurredAt}T00:00:00.000Z`;
  if (movingToInterview) {
    void onScheduleInterview(occurredAtIso);
  } else {
    onChangeStage(nextStage, occurredAtIso);
  }
}

function CardMenu({
  application,
  onChangeStage,
  onScheduleInterview,
  onSaveNote,
  onSkip,
}: {
  application: ApplicationView;
  onChangeStage: (stage: ApplicationStage, occurredAt: string) => void;
  onScheduleInterview: (scheduledAt: string) => Promise<void>;
  onSaveNote: (notes: string) => void;
  onSkip: (reasonId: SkipReasonId) => void;
}) {
  const [noteDraft, setNoteDraft] = useState(application.notes ?? '');
  const canSkip = application.stage === 'saved' && Boolean(application.clusterId);

  return (
    <div className="career-responses-card-menu">
      <StageChangeControl
        stage={application.stage}
        onChangeStage={onChangeStage}
        onScheduleInterview={onScheduleInterview}
      />
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
      {canSkip ? <SkipControl onSkip={onSkip} /> : null}
    </div>
  );
}

function SkipControl({ onSkip }: { onSkip: (reasonId: SkipReasonId) => void }) {
  const [skipping, setSkipping] = useState(false);
  if (!skipping) {
    return (
      <button type="button" onClick={() => setSkipping(true)}>
        Пропустить с причиной
      </button>
    );
  }
  return (
    <ul className="career-responses-reason-list">
      {SKIP_REASONS.map((reason) => (
        <li key={reason.id}>
          <button type="button" onClick={() => onSkip(reason.id)}>
            {reason.label}
          </button>
        </li>
      ))}
    </ul>
  );
}
