import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowClockwise,
  CaretDown,
  DotsThreeVertical,
  FileText,
  Warning,
} from '@phosphor-icons/react';
import { APPLICATION_STAGES, type ApplicationStage } from '../../../shared/applicationStage';
import { SKIP_REASONS, type SkipReasonId } from '../../../shared/skipReasons';
import { InterviewPrepModal } from '../interview/InterviewPrepModal';
import type { ApplicationView } from './applicationsApi';
import { localIsoDate } from './localIsoDate';
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

interface ResponsesCardProps {
  readonly application: ApplicationView;
  readonly failed: boolean;
  readonly conflicted: boolean;
  readonly isMenuOpen?: boolean;
  readonly onToggleMenu?: () => void;
  readonly onCloseMenu?: () => void;
  readonly onChangeStage: (stage: ApplicationStage, occurredAt: string) => void;
  readonly onScheduleInterview: (scheduledAt: string) => Promise<void>;
  readonly onRetry: () => void;
  readonly onRefresh: () => void;
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

function useCardMenuState(
  isMenuOpen: boolean | undefined,
  onToggleMenu: (() => void) | undefined,
  onCloseMenu: (() => void) | undefined,
) {
  const [localMenuOpen, setLocalMenuOpen] = useState(false);
  const menuOpen = isMenuOpen !== undefined ? isMenuOpen : localMenuOpen;
  const toggleMenu = onToggleMenu ?? (() => setLocalMenuOpen((open) => !open));
  const closeMenu = useCallback(
    () => (onCloseMenu ? onCloseMenu() : setLocalMenuOpen(false)),
    [onCloseMenu],
  );
  const cardRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu();
    };
    const handlePointerDown = (event: MouseEvent | PointerEvent) => {
      if (cardRef.current && !cardRef.current.contains(event.target as Node)) {
        closeMenu();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('pointerdown', handlePointerDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [menuOpen, closeMenu]);

  const handleCardClick = (event: React.MouseEvent) => {
    const target = event.target as HTMLElement;
    if (target.closest('button, a, input, select, textarea, label')) return;
    toggleMenu();
  };

  const handleBodyKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      toggleMenu();
    }
  };

  return { menuOpen, toggleMenu, closeMenu, cardRef, handleCardClick, handleBodyKeyDown };
}

function CardHeaderContent({
  title,
  company,
  hasMaterials,
}: {
  title: string;
  company: string;
  hasMaterials: boolean;
}) {
  return (
    <>
      <div className="career-responses-card-role">{title}</div>
      <div className="career-responses-card-company">{company}</div>
      <MaterialsBadge hasMaterials={hasMaterials} />
    </>
  );
}

function CardTopBody({
  vacancy,
  materials,
  onClick,
  onKeyDown,
}: {
  vacancy?: ApplicationView['vacancy'];
  materials: ApplicationView['materials'];
  onClick: (event: React.MouseEvent) => void;
  onKeyDown: (event: React.KeyboardEvent) => void;
}) {
  const company = vacancy?.companyHidden
    ? 'компания скрыта'
    : vacancy?.company || 'компания не указана';
  const hasMaterials = Boolean(materials.coverLetter || materials.resume);

  return (
    <div
      role="button"
      tabIndex={0}
      className="career-responses-card-body"
      onClick={onClick}
      onKeyDown={onKeyDown}
    >
      <CardHeaderContent
        title={vacancy?.title ?? 'Без названия'}
        company={company}
        hasMaterials={hasMaterials}
      />
    </div>
  );
}

export function ResponsesCard(props: ResponsesCardProps) {
  const { application, failed, conflicted, isMenuOpen, onToggleMenu, onCloseMenu } = props;
  const { menuOpen, toggleMenu, closeMenu, cardRef, handleCardClick, handleBodyKeyDown } =
    useCardMenuState(isMenuOpen, onToggleMenu, onCloseMenu);
  const label = waitingLabelFor(application);

  return (
    <article
      ref={cardRef}
      className={`career-responses-card${label.on === 'you' ? ' is-your-turn' : ''}`}
      data-cluster={application.clusterId ?? ''}
    >
      <CardTopBody
        vacancy={application.vacancy}
        materials={application.materials}
        onClick={handleCardClick}
        onKeyDown={handleBodyKeyDown}
      />
      <CardAlerts failed={failed} conflicted={conflicted} onRetry={props.onRetry} onRefresh={props.onRefresh} />
      {application.stage === 'interview' ? (
        <PrepareInterviewControl application={application} />
      ) : null}
      <CardFooter
        application={application}
        labelText={label.text}
        labelOn={label.on}
        menuOpen={menuOpen}
        onToggleMenu={toggleMenu}
        onCloseMenu={closeMenu}
        onChangeStage={props.onChangeStage}
        onScheduleInterview={props.onScheduleInterview}
        onSaveNote={props.onSaveNote}
        onSkip={props.onSkip}
      />
      <FollowUpSentControl application={application} onMark={props.onMarkFollowUpSent} />
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
        {saving ? 'Сохраняем…' : 'Отметить напоминание компании отправленным'}
      </button>
    </div>
  );
}

interface CardFooterProps {
  application: ApplicationView;
  labelText: string;
  labelOn: 'you' | 'them' | null;
  menuOpen: boolean;
  onToggleMenu: () => void;
  onCloseMenu: () => void;
  onChangeStage: (stage: ApplicationStage, occurredAt: string) => void;
  onScheduleInterview: (scheduledAt: string) => Promise<void>;
  onSaveNote: (notes: string) => void;
  onSkip: (reasonId: SkipReasonId) => void;
}

interface CardMenuWrapProps {
  application: ApplicationView;
  menuOpen: boolean;
  onToggleMenu: () => void;
  onCloseMenu: () => void;
  onChangeStage: (stage: ApplicationStage, occurredAt: string) => void;
  onScheduleInterview: (scheduledAt: string) => Promise<void>;
  onSaveNote: (notes: string) => void;
  onSkip: (reasonId: SkipReasonId) => void;
}

function CardMenuWrap(props: CardMenuWrapProps) {
  const { application, menuOpen, onToggleMenu, onCloseMenu } = props;
  return (
    <div className="career-responses-menu-wrap">
      <button
        type="button"
        aria-label="Действия с карточкой"
        onClick={(event) => {
          event.stopPropagation();
          onToggleMenu();
        }}
      >
        <DotsThreeVertical size={18} />
      </button>
      {menuOpen ? (
        <CardMenu
          application={application}
          onChangeStage={(stage, occurredAt) => {
            props.onChangeStage(stage, occurredAt);
            onCloseMenu();
          }}
          onScheduleInterview={(scheduledAt) => {
            onCloseMenu();
            return props.onScheduleInterview(scheduledAt);
          }}
          onSaveNote={(notes) => {
            props.onSaveNote(notes);
            onCloseMenu();
          }}
          onSkip={(reasonId) => {
            props.onSkip(reasonId);
            onCloseMenu();
          }}
        />
      ) : null}
    </div>
  );
}

function CardFooter({
  application,
  labelText,
  labelOn,
  menuOpen,
  onToggleMenu,
  onCloseMenu,
  onChangeStage,
  onScheduleInterview,
  onSaveNote,
  onSkip,
}: CardFooterProps) {
  return (
    <div className="career-responses-card-footer">
      <span className={`career-responses-waiting ${labelOn ? `is-on-${labelOn}` : 'is-closed'}`}>
        {labelText}
      </span>
      <CardMenuWrap
        application={application}
        menuOpen={menuOpen}
        onToggleMenu={onToggleMenu}
        onCloseMenu={onCloseMenu}
        onChangeStage={onChangeStage}
        onScheduleInterview={onScheduleInterview}
        onSaveNote={onSaveNote}
        onSkip={onSkip}
      />
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
  onRefresh,
}: {
  failed: boolean;
  conflicted: boolean;
  onRetry: () => void;
  onRefresh: () => void;
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
          Карточку изменили в другом окне. Ваши изменения не сохранены.{' '}
          <button type="button" onClick={onRefresh}>
            Обновить карточку
          </button>
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
  const [occurredAt, setOccurredAt] = useState(() => localIsoDate());
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
          className="career-btn career-btn-primary career-btn-sm"
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
    <label className="career-responses-select-field">
      Этап
      <div className="career-responses-select-wrap">
        <select value={value} onChange={(event) => onChange(event.target.value as ApplicationStage)}>
          {APPLICATION_STAGES.map((stageOption) => (
            <option key={stageOption} value={stageOption}>
              {STAGE_LABEL[stageOption]}
            </option>
          ))}
        </select>
        <CaretDown size={14} className="career-responses-select-caret" aria-hidden="true" />
      </div>
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
