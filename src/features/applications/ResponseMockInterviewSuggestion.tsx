import { useMemo, useState } from 'react';
import { applicationScreenObject } from '../journey/consultantScreenObjects';
import { usePublishConsultantObject } from '../journey/consultantScreenTopic';
import type { ApplicationView } from './applicationsApi';
import { formatDayMonthTime } from './responseCardFace';
import { InterviewPrepModal } from '../interview/InterviewPrepModal';
import { mockInterviewVacancyFromApplication } from '../interview/mockInterviewVacancy';
import {
  usePublishConsultantSuggestion,
  type ConsultantScreenSuggestion,
} from '../journey/consultantScreenSuggestion';

/**
 * Макет 5: у отклика с интервью консультант предлагает мок-интервью по этой компании.
 * Только из данных отклика: этап, компания, дата интервью; число вопросов не обещаем —
 * тренажёр подбирает их по вакансии и STAR-историям.
 */
export function responseMockInterviewSuggestion(
  application: ApplicationView,
  onStart: () => void,
  now: number = Date.now(),
): ConsultantScreenSuggestion | null {
  if (application.stage !== 'interview') return null;
  const scheduledAt = application.nearestInterview?.scheduledAt;
  if (scheduledAt && Date.parse(scheduledAt) < now) return null;
  const company = application.vacancy?.companyHidden ? undefined : application.vacancy?.company;
  const title = application.vacancy?.title;
  const target = company ? ` по ${company}` : title ? `: ${title}` : '';
  const when = formatDayMonthTime(scheduledAt);
  return {
    id: `mock-interview:${application.id}`,
    stages: ['responses', 'interviews'],
    title: `Мок-интервью${target}`,
    detail: `${when ? `Интервью ${when}` : 'Дата интервью не указана'}, стресс-режим выключен.`,
    acceptLabel: 'Начать',
    dismissLabel: 'Не сейчас',
    onAccept: onStart,
  };
}

/** «Начать» открывает тот же тренажёр, что «Подготовка»: сразу мок-интервью, стресс выключен. */
export function ResponseMockInterviewSuggestion({
  application,
}: {
  readonly application: ApplicationView;
}) {
  const [open, setOpen] = useState(false);
  usePublishConsultantSuggestion(responseMockInterviewSuggestion(application, () => setOpen(true)));
  usePublishConsultantObject(useMemo(() => applicationScreenObject(application.id), [application.id]));
  if (!open) return null;
  return (
    <InterviewPrepModal
      isOpen
      onClose={() => setOpen(false)}
      vacancy={mockInterviewVacancyFromApplication(application)}
      startInMockInterview
      initialStressMode={false}
    />
  );
}
