import type { ApplicationView } from '../applications/applicationsApi';
import type { MockInterviewVacancy } from './mockInterviewSimulatorTypes';

/** Вакансия тренажёра из отклика: роль, компания, дата интервью и источник для «На чём строятся вопросы». */
export function mockInterviewVacancyFromApplication(application: ApplicationView): MockInterviewVacancy {
  const vacancy = application.vacancy;
  return {
    id: application.id,
    applicationId: application.id,
    title: vacancy?.title ?? 'Без названия',
    ...(vacancy?.company && !vacancy.companyHidden ? { company: vacancy.company } : {}),
    ...(application.nearestInterview?.scheduledAt ? { interviewAt: application.nearestInterview.scheduledAt } : {}),
    ...(vacancy?.source ? { source: vacancy.source } : {}),
    sourceSavedAt: application.createdAt,
  };
}
