import { useState } from 'react';
import type { DeliveryReceipt } from '../../../shared/applicationStage';
import { deliveryState } from '../../../shared/applicationStage';
import { humanSourceLabel } from './sourceLabels';
import type { CoachTurnStage, CoachTurnSubject } from '../coach/coachApi';
import { InterviewPrepModal } from '../interview/InterviewPrepModal';
import { StarStoriesModal } from '../interview/StarStoriesModal';
import {
  patchApplication,
  patchApplicationInterview,
  type ApplicationView,
} from './applicationsApi';
import { InterviewDebriefModal, type InterviewDebriefSubmitData } from './InterviewDebriefModal';

export function DeliveryStatus({
  receipt,
  source,
}: {
  readonly receipt: DeliveryReceipt | null;
  readonly source?: string | null;
}) {
  const state = deliveryState('applied', receipt);
  const isLinkedInWithoutReceipt =
    !receipt && humanSourceLabel(source).toLocaleLowerCase('ru-RU') === 'linkedin';
  const label =
    state === 'failed'
      ? 'Не доставлено'
      : state === 'attempted'
        ? 'Пробовали отправить'
        : state === 'delivered'
          ? 'Доставка подтверждена'
          : 'Черновик, не отправлено';
  return (
    <p className={`career-responses-card-delivery is-${state}`} role="status">
      <span>{label}</span>
      {receipt && state === 'delivered' ? <small>Квитанция сохранена</small> : null}
      {isLinkedInWithoutReceipt ? (
        <small>Подтверждение LinkedIn не получено; доставка не подтверждена.</small>
      ) : null}
      {receipt?.kind === 'failure_note' ? <small>{receipt.value}</small> : null}
    </p>
  );
}

export function PrepareInterviewControl({
  application,
  onOpenExpert,
}: {
  readonly application: ApplicationView;
  readonly onOpenExpert?: (
    stage: CoachTurnStage,
    subject?: CoachTurnSubject,
    subjectTitle?: string,
  ) => void;
}) {
  const [open, setOpen] = useState(false);
  const [storiesOpen, setStoriesOpen] = useState(false);
  const askConsultant = buildInterviewPrepExpertHandler(application, onOpenExpert);
  return (
    <>
      <button
        type="button"
        className="career-btn career-btn-secondary career-btn-sm"
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
        onAskConsultant={askConsultant}
        onOpenStarStories={() => {
          setOpen(false);
          setStoriesOpen(true);
        }}
      />
      <StarStoriesModal
        isOpen={storiesOpen}
        onClose={() => setStoriesOpen(false)}
        onAskConsultant={askConsultant}
      />
    </>
  );
}

function buildInterviewPrepExpertHandler(
  application: ApplicationView,
  onOpenExpert?: (stage: CoachTurnStage, subject?: CoachTurnSubject, subjectTitle?: string) => void,
): (() => void) | undefined {
  if (!onOpenExpert) return undefined;
  return () =>
    onOpenExpert(
      'interviews',
      { kind: 'application', id: application.id },
      buildSubjectTitle(application.vacancy),
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

export function buildSubjectTitle(vacancy?: ApplicationView['vacancy']): string {
  const title = vacancy?.title ?? 'Без названия';
  const company = vacancy?.companyHidden ? '' : (vacancy?.company ?? '');
  return `О вакансии: ${title}${company ? ` — ${company}` : ''}`;
}

/** Компактная подпись статуса на лицевой стороне карточки. */
export function CardStageBlocks({
  application,
  onOpenExpert,
}: {
  readonly application: ApplicationView;
  readonly onOpenExpert?: (
    stage: CoachTurnStage,
    subject?: CoachTurnSubject,
    subjectTitle?: string,
  ) => void;
}) {
  if (application.stage === 'applied') {
    return (
      <DeliveryStatus
        receipt={application.deliveryReceipt ?? null}
        source={application.vacancy?.source}
      />
    );
  }
  if (application.stage === 'interview') {
    const date = application.nearestInterview?.scheduledAt;
    return (
      <div className="career-responses-card-interview">
        <p className="career-responses-card-stage">
          {date ? `Интервью ${formatInterviewDate(date)}` : 'Интервью назначено'}
        </p>
        <PrepareInterviewControl application={application} onOpenExpert={onOpenExpert} />
      </div>
    );
  }
  if (application.stage === 'offer')
    return <p className="career-responses-card-stage">Оффер получен</p>;
  if (application.stage === 'saved')
    return <p className="career-responses-card-stage">Черновик, не отправлено</p>;
  return null;
}

function formatInterviewDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'дата не указана'
    : date.toLocaleString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
}
