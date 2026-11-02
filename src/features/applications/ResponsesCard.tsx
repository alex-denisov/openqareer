import { useCallback, useEffect, useRef, useState } from 'react';
import { useEscapeLayer } from '../shell/escapeLayers';
import {
  ArrowClockwise,
  ArrowRight,
  CalendarBlank,
  CaretDown,
  CheckCircle,
  Clock,
  EnvelopeOpen,
  PaperPlaneTilt,
  WarningCircle,
  XCircle,
} from '@phosphor-icons/react';
import { APPLICATION_STAGES, type ApplicationStage } from '../../../shared/applicationStage';
import type { DeliveryReceipt } from '../../../shared/applicationStage';
import { SKIP_REASONS, type SkipReasonId } from '../../../shared/skipReasons';
import type { CoachTurnStage, CoachTurnSubject } from '../coach/coachApi';
import type { ApplicationView } from './applicationsApi';
import { ApplicationLabelsEditor } from './ApplicationLabelsEditor';
import { localIsoDate } from './localIsoDate';
import { responseNextStep, responseStatusPill, type StatusTone } from './responseCardFace';
import { buildSubjectTitle } from './ResponsesCardStageControls';

const STAGE_LABEL: Record<ApplicationStage, string> = {
  saved: 'Хочу',
  applied: 'Пробовали отправить',
  responded: 'Ответ',
  interview: 'Интервью',
  offer: 'Оффер',
  rejected: 'Отказ',
  archived: 'Архив',
};

interface ResponsesCardProps {
  readonly application: ApplicationView;
  readonly selected?: boolean;
  readonly onSelect?: () => void;
  readonly failed: boolean;
  readonly conflicted: boolean;
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
  readonly onSkip: (reasonId: SkipReasonId) => void;
}

/**
 * One card of the tracker board (mockup `.card`, B248/B251 S3). The stage
 * lives in the card menu, not on the face — the mockup's face shows role,
 * company, materials and the next step only (B251 S4 acceptance review);
 * stage change gets its own affordance in the next slice.
 */
function useStatusMenuState() {
  const [menuOpen, setMenuOpen] = useState(false);
  const toggleMenu = () => setMenuOpen((open) => !open);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const cardRef = useRef<HTMLDivElement | null>(null);
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

  return { menuOpen, toggleMenu, closeMenu, cardRef };
}

function CardHeaderContent({ title, company }: { title: string; company: string }) {
  return (
    <>
      <div className="career-responses-card-company">{company}</div>
      <div className="career-responses-card-role">{title}</div>
    </>
  );
}

function CardTopBody({
  vacancy,
  selected,
  onSelect,
}: {
  vacancy?: ApplicationView['vacancy'];
  selected: boolean;
  onSelect?: () => void;
}) {
  const company = vacancy?.companyHidden
    ? 'компания скрыта'
    : vacancy?.company || 'компания не указана';

  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      className={`career-responses-card-body${selected ? ' is-selected' : ''}`}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect?.();
        }
      }}
    >
      <CardHeaderContent title={vacancy?.title ?? 'Без названия'} company={company} />
    </div>
  );
}

export function ResponsesCard(props: ResponsesCardProps) {
  const { application, failed, conflicted } = props;
  const next = responseNextStep(application);

  return (
    <article
      className={`career-responses-card${next.yours ? ' is-your-turn' : ''}${props.selected ? ' is-selected' : ''}`}
      data-cluster={application.clusterId ?? ''}
    >
      <CardTopBody
        vacancy={application.vacancy}
        selected={Boolean(props.selected)}
        onSelect={props.onSelect}
      />
      <CardAlerts
        failed={failed}
        conflicted={conflicted}
        onRetry={props.onRetry}
        onRefresh={props.onRefresh}
      />
      <ResponseStatusPillView application={application} />
      <p className={`career-responses-waiting ${next.yours ? 'is-on-you' : 'is-on-them'}`}>
        <ArrowRight size={14} aria-hidden="true" />
        {next.text}
      </p>
    </article>
  );
}

export interface ResponseStatusMenuProps {
  readonly application: ApplicationView;
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
  readonly onSaveNote: (notes: string) => void;
  readonly onRefresh: () => void;
  readonly onSkip: (reasonId: SkipReasonId) => void;
}

/**
 * The former card "⋮" (B484 R3): the mockup's card face has no menu, so the
 * stage change, labels, note, export and skip live behind the status chip
 * of the selected response panel — the status is what they change.
 */
export function ResponseStatusMenu(props: ResponseStatusMenuProps) {
  const { application } = props;
  const { menuOpen, toggleMenu, closeMenu, cardRef } = useStatusMenuState();
  const pill = responseStatusPill(application);
  const discuss = createCardDiscussionHandler(props, application, closeMenu);
  return (
    <div className="career-responses-menu-wrap" ref={cardRef}>
      <button
        type="button"
        className={`career-responses-status-pill is-${pill.tone} is-trigger`}
        aria-haspopup="dialog"
        aria-expanded={menuOpen}
        title="Изменить статус, метки, заметку"
        onClick={toggleMenu}
      >
        <StatusIcon tone={pill.tone} />
        {pill.label}
        <CaretDown size={12} aria-hidden="true" />
      </button>
      {menuOpen ? (
        <CardMenu
          application={application}
          onDiscussWithConsultant={discuss}
          onChangeStage={(stage, occurredAt, receipt) => {
            props.onChangeStage(stage, occurredAt, receipt);
            closeMenu();
          }}
          onScheduleInterview={(scheduledAt) => {
            closeMenu();
            return props.onScheduleInterview(scheduledAt);
          }}
          onSaveNote={(notes) => {
            props.onSaveNote(notes);
            closeMenu();
          }}
          onRefresh={props.onRefresh}
          onSkip={(reasonId) => {
            props.onSkip(reasonId);
            closeMenu();
          }}
        />
      ) : null}
    </div>
  );
}

function createCardDiscussionHandler(
  props: ResponseStatusMenuProps,
  application: ApplicationView,
  onCloseMenu: () => void,
) {
  if (!props.onOpenExpert) return undefined;
  return () => {
    props.onOpenExpert?.(
      'responses',
      { kind: 'application', id: application.id },
      buildSubjectTitle(application.vacancy),
    );
    onCloseMenu();
  };
}

export function StatusIcon({ tone }: { readonly tone: StatusTone }) {
  const Icon = STATUS_ICON[tone];
  return <Icon size={12} aria-hidden="true" />;
}

const STATUS_ICON: Record<StatusTone, typeof Clock> = {
  draft: Clock,
  sent: PaperPlaneTilt,
  ok: CheckCircle,
  fail: WarningCircle,
  reply: EnvelopeOpen,
  interview: CalendarBlank,
  offer: CheckCircle,
  closed: XCircle,
};

function ResponseStatusPillView({ application }: { readonly application: ApplicationView }) {
  const pill = responseStatusPill(application);
  return (
    <p className={`career-responses-status-pill is-${pill.tone}`}>
      <StatusIcon tone={pill.tone} />
      {pill.label}
    </p>
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
      <label className="career-responses-select-field">
        Доказательство доставки
        <div className="career-responses-select-wrap">
          <select
            className="career-responses-select"
            value={kind}
            onChange={(event) => onKindChange(event.target.value as DeliveryReceipt['kind'])}
          >
            <option value="confirmation_url">Ссылка на подтверждение</option>
            <option value="auto_reply">Письмо автоответа</option>
            <option value="screenshot">Скриншот</option>
            <option value="failure_note">Попытка не удалась</option>
          </select>
          <CaretDown size={14} className="career-responses-select-caret" aria-hidden="true" />
        </div>
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
          className="career-responses-select"
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

interface CardMenuProps {
  readonly application: ApplicationView;
  readonly onDiscussWithConsultant?: () => void;
  readonly onChangeStage: (
    stage: ApplicationStage,
    occurredAt: string,
    receipt?: DeliveryReceipt | null,
  ) => void;
  readonly onScheduleInterview: (scheduledAt: string) => Promise<void>;
  readonly onSaveNote: (notes: string) => void;
  readonly onRefresh: () => void;
  readonly onSkip: (reasonId: SkipReasonId) => void;
}

export function CardMenu(props: CardMenuProps) {
  const { application, onChangeStage, onScheduleInterview } = props;
  return (
    <div className="career-responses-card-menu">
      <StageChangeControl
        application={application}
        stage={application.stage}
        onChangeStage={onChangeStage}
        onScheduleInterview={onScheduleInterview}
      />
      <CardMenuExtras {...props} />
    </div>
  );
}

function CardMenuExtras(
  props: Pick<
    CardMenuProps,
    'application' | 'onDiscussWithConsultant' | 'onSaveNote' | 'onRefresh' | 'onSkip'
  >,
) {
  const { application, onDiscussWithConsultant, onSaveNote, onRefresh, onSkip } = props;
  const canSkip = application.stage === 'saved' && Boolean(application.clusterId);
  return (
    <>
      <ApplicationLabelsEditor
        applicationId={application.id}
        assigned={application.labels ?? []}
        onRefresh={onRefresh}
      />
      <button type="button" onClick={() => exportApplication(application)}>
        Экспорт
      </button>
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
    </>
  );
}

function exportApplication(application: ApplicationView) {
  const vacancy = application.vacancy;
  const company = vacancy?.companyHidden ? 'Компания скрыта' : (vacancy?.company ?? '');
  const rows = [
    ['Компания', company],
    ['Роль', vacancy?.title ?? ''],
    ['Канал', vacancy?.source ?? ''],
    ['Этап', STAGE_LABEL[application.stage]],
    ['Дата отклика', application.createdAt],
    ['Следующий шаг', application.followUp?.dueAt ?? application.followUpDueAt ?? ''],
    ['Квитанция', application.deliveryReceipt?.value ?? ''],
  ];
  const csv = rows.map(([label, value]) => `${csvCell(label)},${csvCell(value)}`).join('\r\n');
  const href = URL.createObjectURL(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = href;
  link.download = `response-${application.id.replace(/[^a-z0-9-]/giu, '-')}.csv`;
  link.click();
  URL.revokeObjectURL(href);
}

function csvCell(value: string) {
  return `"${value.replace(/"/gu, '""')}"`;
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
