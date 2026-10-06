import { useState } from 'react';
import type { DeliveryReceipt } from '../../../shared/applicationStage';
import { deliveryState } from '../../../shared/applicationStage';
import type { CoachTurnStage, CoachTurnSubject } from '../coach/coachApi';
import { InterviewPrepModal } from '../interview/InterviewPrepModal';
import {
  patchApplication,
  patchApplicationInterview,
  type ApplicationView,
} from './applicationsApi';
import { InterviewDebriefModal, type InterviewDebriefSubmitData } from './InterviewDebriefModal';
import { calculateOfferCompensation } from './offerCompensation';

export function DeliveryStatus({ receipt }: { receipt: DeliveryReceipt | null }) {
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
export function PrepareInterviewControl({
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

async function saveDebriefForApplication(
  application: ApplicationView,
  data: InterviewDebriefSubmitData,
  onSaveDebrief?: (data: InterviewDebriefSubmitData) => Promise<void>,
) {
  if (onSaveDebrief) {
    await onSaveDebrief(data);
    return;
  }
  if (application.nearestInterview?.id) {
    await patchApplicationInterview(application.id, application.nearestInterview.id, {
      debrief: JSON.stringify(data),
      followUpDueAt: data.promisedResponseDate,
    });
  } else {
    await patchApplication(application.id, {
      expectedVersion: application.version,
      followUpDueAt: data.promisedResponseDate,
    });
  }
}

export function InterviewDebriefControl({
  application,
  onSaveDebrief,
  onRefresh,
}: {
  application: ApplicationView;
  onSaveDebrief?: (data: InterviewDebriefSubmitData) => Promise<void>;
  onRefresh?: () => void;
}) {
  const [open, setOpen] = useState(false);

  const handleSave = async (data: InterviewDebriefSubmitData) => {
    await saveDebriefForApplication(application, data, onSaveDebrief);
    onRefresh?.();
  };

  const company = application.vacancy?.companyHidden
    ? undefined
    : (application.vacancy?.company ?? undefined);

  return (
    <div className="career-responses-debrief-action">
      <button
        type="button"
        className="career-btn career-btn-secondary career-btn-sm"
        onClick={() => setOpen(true)}
      >
        Дебрифинг
      </button>
      <InterviewDebriefModal
        isOpen={open}
        onClose={() => setOpen(false)}
        onSave={handleSave}
        vacancyTitle={application.vacancy?.title ?? 'Без названия'}
        company={company}
        initialPromisedDate={application.followUpDueAt}
      />
    </div>
  );
}

export function FollowUpSentControl({
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

export function OfferCardControl({
  application,
  onOpenOfferEdit,
}: {
  application: ApplicationView;
  onOpenOfferEdit?: (applicationId: string) => void;
}) {
  const terms = application.offer?.terms;
  const breakdown = terms ? calculateOfferCompensation(terms) : null;
  const currencySymbol =
    breakdown?.currency === 'RUB'
      ? '₽'
      : breakdown?.currency === 'USD'
        ? '$'
        : breakdown?.currency === 'EUR'
          ? '€'
          : (breakdown?.currency ?? '');

  return (
    <div className="career-responses-offer-action">
      {breakdown ? (
        <div className="career-responses-card-offer-preview">
          <span className="career-mono">
            {new Intl.NumberFormat('ru-RU').format(breakdown.monthlyAverage)} {currencySymbol}/мес.
          </span>
          <span className="career-offer-source-badge">{breakdown.sourceLabel}</span>
        </div>
      ) : null}
      {onOpenOfferEdit ? (
        <button
          type="button"
          className="career-btn career-btn-secondary career-btn-sm"
          onClick={() => onOpenOfferEdit(application.id)}
        >
          {application.offer ? 'Условия оффера' : 'Заполнить оффер'}
        </button>
      ) : null}
    </div>
  );
}

export function buildSubjectTitle(vacancy?: ApplicationView['vacancy']): string {
  const title = vacancy?.title ?? 'Без названия';
  const company = vacancy?.companyHidden ? '' : (vacancy?.company ?? '');
  return `О вакансии: ${title}${company ? ` — ${company}` : ''}`;
}

/** Блоки карточки, зависящие от этапа: доставка, интервью, оффер. */
export function CardStageBlocks({
  application,
  onOpenExpert,
  onSaveDebrief,
  onRefresh,
  onOpenOfferEdit,
}: {
  readonly application: ApplicationView;
  readonly onOpenExpert?: (
    stage: CoachTurnStage,
    subject?: CoachTurnSubject,
    subjectTitle?: string,
  ) => void;
  readonly onSaveDebrief?: (data: InterviewDebriefSubmitData) => Promise<void>;
  readonly onRefresh: () => void;
  readonly onOpenOfferEdit?: (applicationId: string) => void;
}) {
  if (application.stage === 'applied') {
    return <DeliveryStatus receipt={application.deliveryReceipt ?? null} />;
  }
  if (application.stage === 'interview') {
    return (
      <div className="career-responses-interview-actions">
        <PrepareInterviewControl application={application} onOpenExpert={onOpenExpert} />
        <InterviewDebriefControl
          application={application}
          onSaveDebrief={onSaveDebrief}
          onRefresh={onRefresh}
        />
      </div>
    );
  }
  if (application.stage === 'offer') {
    return <OfferCardControl application={application} onOpenOfferEdit={onOpenOfferEdit} />;
  }
  return null;
}
