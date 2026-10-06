import { useCallback, useEffect, useRef, useState } from 'react';
import { useEscapeLayer } from '../shell/escapeLayers';
import {
  ArrowClockwise,
  CaretDown,
  DotsThreeVertical,
  FileText,
  Warning,
} from '@phosphor-icons/react';
import { APPLICATION_STAGES, type ApplicationStage } from '../../../shared/applicationStage';
import type { DeliveryReceipt } from '../../../shared/applicationStage';
import { deliveryState } from '../../../shared/applicationStage';
import { SKIP_REASONS, type SkipReasonId } from '../../../shared/skipReasons';
import type { CoachTurnStage, CoachTurnSubject } from '../coach/coachApi';
import { InterviewPrepModal } from '../interview/InterviewPrepModal';
import type { ApplicationView } from './applicationsApi';
import { localIsoDate } from './localIsoDate';
import { waitingLabel } from './waitingLabel';

const STAGE_LABEL: Record<ApplicationStage, string> = {
  saved: 'Хочу',
  applied: 'Пробовали отправить',
  responded: 'Ответ',
  interview: 'Интервью',
  offer: 'Оффер',
  rejected: 'Отказ',
  archived: 'Архив',
};

function buildSubjectTitle(vacancy?: ApplicationView['vacancy']): string {
  const title = vacancy?.title ?? 'Без названия';
  const company = vacancy?.companyHidden ? '' : (vacancy?.company ?? '');
  return `О вакансии: ${title}${company ? ` — ${company}` : ''}`;
}

interface ResponsesCardProps {
  readonly application: ApplicationView;
  readonly failed: boolean;
  readonly conflicted: boolean;
  readonly isMenuOpen?: boolean;
  readonly onToggleMenu?: () => void;
  readonly onCloseMenu?: () => void;
  readonly onOpenExpert?: (
    stage: CoachTurnStage,
    subject?: CoachTurnSubject,
    subjectTitle?: string,
  ) => void;
  readonly onChangeStage: (
    stage: ApplicationStage,
    occurredAt: string,
    receipt?: DeliveryReceipt | null,
  ) => void;
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
  useEscapeLayer(closeMenu, menuOpen);

  useEffect(() => {
    if (!menuOpen) return;
    const handlePointerDown = (event: MouseEvent | PointerEvent) => {
      if (cardRef.current && !cardRef.current.contains(event.target as Node)) {
        closeMenu();
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => {
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
      <CardAlerts
        failed={failed}
        conflicted={conflicted}
        onRetry={props.onRetry}
        onRefresh={props.onRefresh}
      />
      {application.stage === 'applied' ? (
        <DeliveryStatus receipt={application.deliveryReceipt ?? null} />
      ) : null}
      {application.stage === 'interview' ? (
        <PrepareInterviewControl application={application} onOpenExpert={props.onOpenExpert} />
      ) : null}
      <CardFooter
        application={application}
        labelText={label.text}
        labelOn={label.on}
        menuOpen={menuOpen}
        onToggleMenu={toggleMenu}
        onCloseMenu={closeMenu}
        onOpenExpert={props.onOpenExpert}
        onChangeStage={props.onChangeStage}
        onScheduleInterview={props.onScheduleInterview}
        onSaveNote={props.onSaveNote}
        onSkip={props.onSkip}
      />
      <FollowUpSentControl application={application} onMark={props.onMarkFollowUpSent} />
    </article>
  );
}

function DeliveryStatus({ receipt }: { receipt: DeliveryReceipt | null }) {
  const state = deliveryState('applied', receipt);
  const label =
    state === 'failed'
      ? 'Попытка не удалась. Доставка не подтверждена.'
      : state === 'attempted'
        ? 'Пробовали отправить. Не хватает квитанции доставки.'
        : `Доставка подтверждена: ${receipt?.value ?? ''}`;
  return (
    <p className="career-responses-card-failed" role="status">
      {label}
    </p>
  );
}

/** «Подготовиться» from a card already in the interview stage (B251 F5) opens
 * the same prep material «Сегодня» offers — no separate prep screen exists
 * yet (`docs/v1-release/tasks/codex/C47-b251-interview-path-from-card.md`). */
function PrepareInterviewControl({
  application,
  onOpenExpert,
}: {
  application: ApplicationView;
  onOpenExpert?: (stage: CoachTurnStage, subject?: CoachTurnSubject, subjectTitle?: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const handleAskConsultant = onOpenExpert
    ? () => {
        onOpenExpert(
          'interviews',
          { kind: 'application', id: application.id },
          buildSubjectTitle(application.vacancy),
        );
      }
    : undefined;

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
        onAskConsultant={handleAskConsultant}
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
        {saving ? 'Сохраняем…' : 'Напоминание отправлено'}
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
  onOpenExpert?: (stage: CoachTurnStage, subject?: CoachTurnSubject, subjectTitle?: string) => void;
  onChangeStage: (
    stage: ApplicationStage,
    occurredAt: string,
    receipt?: DeliveryReceipt | null,
  ) => void;
  onScheduleInterview: (scheduledAt: string) => Promise<void>;
  onSaveNote: (notes: string) => void;
  onSkip: (reasonId: SkipReasonId) => void;
}

interface CardMenuWrapProps {
  application: ApplicationView;
  menuOpen: boolean;
  onToggleMenu: () => void;
  onCloseMenu: () => void;
  onOpenExpert?: (stage: CoachTurnStage, subject?: CoachTurnSubject, subjectTitle?: string) => void;
  onChangeStage: (
    stage: ApplicationStage,
    occurredAt: string,
    receipt?: DeliveryReceipt | null,
  ) => void;
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
          onDiscussWithConsultant={
            props.onOpenExpert
              ? () => {
                  props.onOpenExpert?.(
                    'responses',
                    { kind: 'application', id: application.id },
                    buildSubjectTitle(application.vacancy),
                  );
                  onCloseMenu();
                }
              : undefined
          }
          onChangeStage={(stage, occurredAt, receipt) => {
            props.onChangeStage(stage, occurredAt, receipt);
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
  onOpenExpert,
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
        onOpenExpert={onOpenExpert}
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
  application,
  stage,
  onChangeStage,
  onScheduleInterview,
}: {
  application: ApplicationView;
  stage: ApplicationStage;
  onChangeStage: (
    stage: ApplicationStage,
    occurredAt: string,
    receipt?: DeliveryReceipt | null,
  ) => void;
  onScheduleInterview: (scheduledAt: string) => Promise<void>;
}) {
  const [nextStage, setNextStage] = useState<ApplicationStage>(stage);
  const [occurredAt, setOccurredAt] = useState(() => localIsoDate());
  const [receiptKind, setReceiptKind] = useState<DeliveryReceipt['kind']>(
    application.deliveryReceipt?.kind ?? 'confirmation_url',
  );
  const [receiptValue, setReceiptValue] = useState(application.deliveryReceipt?.value ?? '');
  const dirty = stageChangeIsDirty(nextStage, stage, receiptValue, application.deliveryReceipt);
  return (
    <div className="career-responses-stage-control">
      <StageSelect value={nextStage} onChange={setNextStage} />
      <StageDateField
        isInterview={nextStage === 'interview'}
        value={occurredAt}
        onChange={setOccurredAt}
      />
      <StageDeliveryEvidence
        visible={nextStage === 'applied'}
        kind={receiptKind}
        value={receiptValue}
        onKindChange={setReceiptKind}
        onValueChange={setReceiptValue}
      />
      <SaveStageButton
        dirty={dirty}
        nextStage={nextStage}
        hasReceipt={Boolean(receiptValue.trim())}
        occurredAt={occurredAt}
        receiptKind={receiptKind}
        receiptValue={receiptValue}
        onChangeStage={onChangeStage}
        onScheduleInterview={onScheduleInterview}
      />
    </div>
  );
}

function StageDeliveryEvidence({
  visible,
  ...fields
}: { visible: boolean } & Parameters<typeof DeliveryReceiptFields>[0]) {
  return visible ? <DeliveryReceiptFields {...fields} /> : null;
}

function stageChangeIsDirty(
  nextStage: ApplicationStage,
  stage: ApplicationStage,
  receiptValue: string,
  receipt?: DeliveryReceipt | null,
): boolean {
  return (
    nextStage !== stage ||
    (nextStage === 'applied' && receiptValue.trim() !== (receipt?.value ?? ''))
  );
}

function StageDateField({
  isInterview,
  value,
  onChange,
}: {
  isInterview: boolean;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label>
      {isInterview ? 'Дата интервью' : 'Дата'}
      <input type="date" value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function SaveStageButton({
  dirty,
  nextStage,
  hasReceipt,
  occurredAt,
  receiptKind,
  receiptValue,
  onChangeStage,
  onScheduleInterview,
}: {
  dirty: boolean;
  nextStage: ApplicationStage;
  hasReceipt: boolean;
  occurredAt: string;
  receiptKind: DeliveryReceipt['kind'];
  receiptValue: string;
  onChangeStage: (
    stage: ApplicationStage,
    occurredAt: string,
    receipt?: DeliveryReceipt | null,
  ) => void;
  onScheduleInterview: (scheduledAt: string) => Promise<void>;
}) {
  if (!dirty) return null;
  const label = nextStage === 'applied' && hasReceipt ? 'Сохранить квитанцию' : 'Сохранить этап';
  const receipt: DeliveryReceipt | null | undefined = receiptValue.trim()
    ? { kind: receiptKind, value: receiptValue.trim() }
    : nextStage === 'applied'
      ? null
      : undefined;
  return (
    <button
      type="button"
      className="career-btn career-btn-primary career-btn-sm"
      onClick={() =>
        saveStageChange({
          nextStage,
          occurredAt,
          movingToInterview: nextStage === 'interview',
          receipt,
          onChangeStage,
          onScheduleInterview,
        })
      }
    >
      {label}
    </button>
  );
}

function DeliveryReceiptFields({
  kind,
  value,
  onKindChange,
  onValueChange,
}: {
  kind: DeliveryReceipt['kind'];
  value: string;
  onKindChange: (kind: DeliveryReceipt['kind']) => void;
  onValueChange: (value: string) => void;
}) {
  return (
    <>
      <label>
        Доказательство доставки
        <select
          value={kind}
          onChange={(event) => onKindChange(event.target.value as DeliveryReceipt['kind'])}
        >
          <option value="confirmation_url">Ссылка на подтверждение</option>
          <option value="auto_reply">Письмо автоответа</option>
          <option value="screenshot">Скриншот</option>
          <option value="failure_note">Попытка не удалась</option>
        </select>
      </label>
      <label>
        Ссылка или описание доказательства
        <input
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
          maxLength={2000}
        />
      </label>
    </>
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
        <select
          value={value}
          onChange={(event) => onChange(event.target.value as ApplicationStage)}
        >
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
  receipt,
  onChangeStage,
  onScheduleInterview,
}: {
  nextStage: ApplicationStage;
  occurredAt: string;
  movingToInterview: boolean;
  receipt?: DeliveryReceipt | null;
  onChangeStage: (
    stage: ApplicationStage,
    occurredAt: string,
    receipt?: DeliveryReceipt | null,
  ) => void;
  onScheduleInterview: (scheduledAt: string) => Promise<void>;
}) {
  const occurredAtIso = `${occurredAt}T00:00:00.000Z`;
  if (movingToInterview) {
    void onScheduleInterview(occurredAtIso);
  } else {
    onChangeStage(nextStage, occurredAtIso, receipt);
  }
}

function CardMenu({
  application,
  onDiscussWithConsultant,
  onChangeStage,
  onScheduleInterview,
  onSaveNote,
  onSkip,
}: {
  application: ApplicationView;
  onDiscussWithConsultant?: () => void;
  onChangeStage: (
    stage: ApplicationStage,
    occurredAt: string,
    receipt?: DeliveryReceipt | null,
  ) => void;
  onScheduleInterview: (scheduledAt: string) => Promise<void>;
  onSaveNote: (notes: string) => void;
  onSkip: (reasonId: SkipReasonId) => void;
}) {
  const canSkip = application.stage === 'saved' && Boolean(application.clusterId);

  return (
    <div className="career-responses-card-menu">
      <StageChangeControl
        application={application}
        stage={application.stage}
        onChangeStage={onChangeStage}
        onScheduleInterview={onScheduleInterview}
      />
      {onDiscussWithConsultant ? (
        <button type="button" onClick={onDiscussWithConsultant}>
          Обсудить с консультантом
        </button>
      ) : null}
      {application.vacancy?.url ? (
        <a href={application.vacancy.url} target="_blank" rel="noreferrer">
          Открыть карточку вакансии
        </a>
      ) : null}
      <CardNoteField initialValue={application.notes ?? ''} onSave={onSaveNote} />
      {canSkip ? <SkipControl onSkip={onSkip} /> : null}
    </div>
  );
}

function CardNoteField({
  initialValue,
  onSave,
}: {
  initialValue: string;
  onSave: (value: string) => void;
}) {
  const [noteDraft, setNoteDraft] = useState(initialValue);
  return (
    <label className="career-responses-note-field">
      Заметка
      <textarea
        value={noteDraft}
        onChange={(event) => setNoteDraft(event.target.value)}
        onBlur={() => onSave(noteDraft)}
      />
    </label>
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
