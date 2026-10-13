import {
  listApplications,
  patchApplication,
  patchApplicationInterview,
} from '../applications/applicationsApi';
import type { CandidateNotification } from './notificationsApi';
import { notificationSourceId } from './notificationPresentation';

const DAY_MS = 24 * 60 * 60 * 1_000;

export async function scheduleInterviewReminder(item: CandidateNotification): Promise<void> {
  const interviewId = notificationSourceId(item);
  if (!interviewId) throw new Error('Не удалось определить интервью из уведомления.');
  const applications = await listApplications();
  const application = applications.find((candidate) => candidate.nearestInterview?.id === interviewId);
  const scheduledAt = application?.nearestInterview?.scheduledAt;
  if (!application || !scheduledAt) throw new Error('Интервью больше не найдено в откликах.');
  const dayBefore = new Date(Date.parse(scheduledAt) - DAY_MS);
  const dueAt = dayBefore.getTime() > Date.now() ? dayBefore : new Date();
  await patchApplicationInterview(application.id, interviewId, { followUpDueAt: dueAt.toISOString() });
}

export async function scheduleRecruiterReminder(item: CandidateNotification): Promise<void> {
  const applicationId = notificationSourceId(item);
  if (!applicationId) throw new Error('Не удалось определить отклик из уведомления.');
  const application = (await listApplications()).find((candidate) => candidate.id === applicationId);
  if (!application) throw new Error('Отклик больше не найден.');
  await patchApplication(application.id, {
    expectedVersion: application.version,
    followUpDueAt: new Date(Date.now() + DAY_MS).toISOString(),
  });
}
