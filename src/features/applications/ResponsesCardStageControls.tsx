import { useState, type ReactNode } from 'react';
import {
  patchApplication,
  patchApplicationInterview,
  type ApplicationView,
} from './applicationsApi';
import {
  InterviewDebriefInline,
  InterviewDebriefModal,
  type InterviewDebriefSubmitData,
} from './InterviewDebriefModal';

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
  label = 'Дебрифинг',
  buttonClassName = 'career-btn career-btn-secondary career-btn-sm',
}: {
  application: ApplicationView;
  onSaveDebrief?: (data: InterviewDebriefSubmitData) => Promise<void>;
  onRefresh?: () => void;
  label?: ReactNode;
  buttonClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="career-responses-debrief-action">
      <button type="button" className={buttonClassName} onClick={() => setOpen(true)}>
        {label}
      </button>
      <InterviewDebriefDialog
        application={application}
        isOpen={open}
        onClose={() => setOpen(false)}
        onSaveDebrief={onSaveDebrief}
        onRefresh={onRefresh}
      />
    </div>
  );
}

/** Окно дебрифа по отклику; открывается и кнопкой «Заполнить», и предложением консультанта. */
export function InterviewDebriefDialog({
  application,
  isOpen,
  onClose,
  onSaveDebrief,
  onRefresh,
}: {
  application: ApplicationView;
  isOpen: boolean;
  onClose: () => void;
  onSaveDebrief?: (data: InterviewDebriefSubmitData) => Promise<void>;
  onRefresh?: () => void;
}) {
  const handleSave = async (data: InterviewDebriefSubmitData) => {
    await saveDebriefForApplication(application, data, onSaveDebrief);
    onRefresh?.();
  };

  const company = application.vacancy?.companyHidden
    ? undefined
    : (application.vacancy?.company ?? undefined);

  return (
    <InterviewDebriefModal
      isOpen={isOpen}
      onClose={onClose}
      onSave={handleSave}
      vacancyTitle={application.vacancy?.title ?? 'Без названия'}
      company={company}
      initialPromisedDate={application.followUpDueAt}
    />
  );
}

/** The debrief form of one response laid on a 390 push screen; saving returns to the list. */
export function InterviewDebriefPushForm({
  application,
  onDone,
  onRefresh,
}: {
  application: ApplicationView;
  onDone: () => void;
  onRefresh?: () => void;
}) {
  return (
    <InterviewDebriefInline
      onClose={onDone}
      onSave={async (data) => {
        await saveDebriefForApplication(application, data);
        onRefresh?.();
      }}
      initialPromisedDate={application.followUpDueAt}
    />
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
