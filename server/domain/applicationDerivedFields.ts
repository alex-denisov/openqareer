import { computeApplicationTurn, type ApplicationTurn } from '../../shared/applicationTurn';
import { computeFollowUpStatus, type FollowUpStatus } from '../../shared/followUpPolicy';
import type {
  StoredApplication,
  StoredApplicationEvent,
} from '../data/sqliteApplicationRepository';
import type { StoredApplicationMaterial } from '../data/sqliteApplicationMaterialsRepository';
import type { StoredApplicationInterview } from '../data/sqliteApplicationInterviewRepository';

/** Stages the follow-up clock runs for; `saved` has no follow-up yet, closed stages have none either. */
const FOLLOW_UP_ACTIVE_STAGES = new Set(['applied', 'responded']);
const INTERVIEW_PREP_WINDOW_MS = 72 * 60 * 60 * 1000;

export interface ApplicationInterviewSummary {
  readonly id: string;
  readonly scheduledAt: string | null;
  readonly prepStatus: StoredApplicationInterview['prepStatus'];
}

export interface ApplicationView extends StoredApplication, ApplicationDerivedFields {}

export interface ApplicationDerivedFields {
  readonly followUp: FollowUpStatus | null;
  readonly whoseTurn: ApplicationTurn;
  readonly materials: { readonly coverLetter: boolean; readonly resume: boolean };
  readonly nearestInterview: ApplicationInterviewSummary | null;
}

export interface DeriveApplicationFieldsInput {
  readonly application: StoredApplication;
  readonly events: readonly StoredApplicationEvent[];
  readonly materials: readonly StoredApplicationMaterial[];
  readonly interviews: readonly StoredApplicationInterview[];
  readonly now?: string;
  readonly timezoneOffsetMinutes?: number;
}

/** Architecture.md §3: "чья очередь хода", follow-up, and the funnel's per-card summary. */
export function deriveApplicationFields(input: DeriveApplicationFieldsInput): ApplicationDerivedFields {
  const now = input.now ?? new Date().toISOString();
  const materials = {
    coverLetter: input.materials.some((material) => material.role === 'cover_letter'),
    resume: input.materials.some((material) => material.role === 'resume'),
  };
  const nearestInterview = pickNearestInterview(input.interviews, now);
  const followUp = FOLLOW_UP_ACTIVE_STAGES.has(input.application.stage)
    ? computeFollowUpStatus({
        processProfile: input.application.processProfile,
        lastContactAt: lastContactAt(input.application, input.events),
        companyDueAt: input.application.followUpDueAt,
        now,
        timezoneOffsetMinutes: input.timezoneOffsetMinutes,
      })
    : null;
  const whoseTurn = computeApplicationTurn({
    stage: input.application.stage,
    followUpUrgency: followUp?.urgency ?? null,
    hasMaterials: materials.coverLetter || materials.resume,
    upcomingInterviewNeedsPrep: needsPrepSoon(nearestInterview, now),
  });
  return {
    followUp,
    whoseTurn,
    materials,
    nearestInterview: nearestInterview
      ? { id: nearestInterview.id, scheduledAt: nearestInterview.scheduledAt, prepStatus: nearestInterview.prepStatus }
      : null,
  };
}

/** "Последнее из событий: отклик, отправленный follow-up, ответ компании" (architecture.md §3). */
function lastContactAt(application: StoredApplication, events: readonly StoredApplicationEvent[]): string {
  const candidates = events
    .filter(
      (event) =>
        event.kind === 'follow_up_sent' ||
        (event.kind === 'stage' && (event.toStage === 'applied' || event.toStage === 'responded')),
    )
    .map((event) => event.occurredAt);
  return candidates.length > 0
    ? candidates.reduce((latest, current) => (current > latest ? current : latest))
    : application.stageChangedAt;
}

function pickNearestInterview(
  interviews: readonly StoredApplicationInterview[],
  now: string,
): StoredApplicationInterview | null {
  const upcoming = interviews
    .filter((interview) => interview.scheduledAt && interview.scheduledAt >= now)
    .sort((a, b) => (a.scheduledAt as string).localeCompare(b.scheduledAt as string));
  return upcoming[0] ?? null;
}

function needsPrepSoon(interview: StoredApplicationInterview | null, now: string): boolean {
  if (!interview?.scheduledAt || interview.prepStatus === 'ready') return false;
  return new Date(interview.scheduledAt).getTime() - new Date(now).getTime() <= INTERVIEW_PREP_WINDOW_MS;
}
