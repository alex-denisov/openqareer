export type ApplicationStatus = 'sent' | 'viewed' | 'invited' | 'rejected';

interface ApplicationHistoryEntry {
  status: ApplicationStatus;
  timestamp: string;
  note?: string;
}

export interface CandidateApplication {
  id: string;
  vacancyId: string;
  vacancyTitle: string;
  company: string;
  platform: 'hh' | 'linkedin' | 'custom';
  sourceUrl?: string;
  resumeId?: string;
  status: ApplicationStatus;
  createdAt: string;
  updatedAt: string;
  history: ApplicationHistoryEntry[];
}

export interface FunnelMetrics {
  totalSent: number;
  viewedCount: number;
  invitedCount: number;
  rejectedCount: number;
  viewRate: number; // percentage
  interviewRate: number; // percentage
}

export function createApplicationRecord(input: {
  id: string;
  vacancyId: string;
  vacancyTitle: string;
  company: string;
  platform: 'hh' | 'linkedin' | 'custom';
  sourceUrl?: string;
  resumeId?: string;
  now?: string;
}): CandidateApplication {
  const now = input.now ?? new Date().toISOString();
  return {
    id: input.id,
    vacancyId: input.vacancyId,
    vacancyTitle: input.vacancyTitle,
    company: input.company,
    platform: input.platform,
    sourceUrl: input.sourceUrl,
    resumeId: input.resumeId,
    status: 'sent',
    createdAt: now,
    updatedAt: now,
    history: [
      {
        status: 'sent',
        timestamp: now,
        note: 'Отклик отправлен',
      },
    ],
  };
}

export function updateApplicationStatus(
  app: CandidateApplication,
  newStatus: ApplicationStatus,
  note?: string,
  now?: string,
): CandidateApplication {
  const timestamp = now ?? new Date().toISOString();
  return {
    ...app,
    status: newStatus,
    updatedAt: timestamp,
    history: [
      ...app.history,
      {
        status: newStatus,
        timestamp,
        note,
      },
    ],
  };
}

export function calculateFunnelMetrics(applications: readonly CandidateApplication[]): FunnelMetrics {
  const totalSent = applications.length;
  if (totalSent === 0) {
    return {
      totalSent: 0,
      viewedCount: 0,
      invitedCount: 0,
      rejectedCount: 0,
      viewRate: 0,
      interviewRate: 0,
    };
  }

  const viewedCount = applications.filter((a) =>
    a.status === 'viewed' || a.history.some((h) => h.status === 'viewed'),
  ).length;

  const invitedCount = applications.filter((a) =>
    a.status === 'invited' || a.history.some((h) => h.status === 'invited'),
  ).length;

  const rejectedCount = applications.filter((a) => a.status === 'rejected').length;

  const viewRate = Math.round((viewedCount / totalSent) * 100);
  const interviewRate = Math.round((invitedCount / totalSent) * 100);

  return {
    totalSent,
    viewedCount,
    invitedCount,
    rejectedCount,
    viewRate,
    interviewRate,
  };
}
