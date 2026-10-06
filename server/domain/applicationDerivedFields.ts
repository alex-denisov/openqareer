import { computeApplicationTurn, type ApplicationTurn } from '../../shared/applicationTurn';
import { computeFollowUpStatus, type FollowUpStatus } from '../../shared/followUpPolicy';
import type {
  StoredApplication,
  StoredApplicationEvent,
} from '../data/sqliteApplicationRepository';
import type { DeliveryReceipt } from '../../shared/applicationStage';
import type { StoredApplicationMaterial } from '../data/sqliteApplicationMaterialsRepository';
import type { StoredApplicationInterview } from '../data/sqliteApplicationInterviewRepository';
import type { StoredApplicationOffer } from '../data/sqliteApplicationOfferRepository';

/** Stages the follow-up clock runs for; `saved` has no follow-up yet, closed stages have none either. */
const FOLLOW_UP_ACTIVE_STAGES = new Set(['applied', 'responded']);
const INTERVIEW_PREP_WINDOW_MS = 72 * 60 * 60 * 1000;

export interface ApplicationInterviewSummary {
  readonly id: string;
  readonly scheduledAt: string | null;
  readonly prepStatus: StoredApplicationInterview['prepStatus'];
  readonly round: number;
}

export interface ApplicationView extends StoredApplication, ApplicationDerivedFields {
  readonly archiveStaleDays?: number;
  readonly offer?: StoredApplicationOffer | null;
}

export interface ApplicationDerivedFields {
  readonly followUp: FollowUpStatus | null;
  readonly whoseTurn: ApplicationTurn;
  readonly materials: { readonly coverLetter: boolean; readonly resume: boolean };
  readonly nearestInterview: ApplicationInterviewSummary | null;
  readonly deliveryReceipt?: DeliveryReceipt | null;
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
export function deriveApplicationFields(
  input: DeriveApplicationFieldsInput,
): ApplicationDerivedFields {
  const now = input.now ?? new Date().toISOString();
  const materials = {
    coverLetter: input.materials.some((material) => material.role === 'cover_letter'),
    resume: input.materials.some((material) => material.role === 'resume'),
  };
  const nearestInterview = pickNearestInterview(input.interviews, now);
  const followUp = FOLLOW_UP_ACTIVE_STAGES.has(input.application.stage)
    ? computeFollowUpStatus({
        processProfile: input.application.processProfile,
        appliedAt: applicationAppliedAt(input.application, input.events),
        lastContactAt: lastContactAt(input.application, input.events),
        remindersSent: followUpSentCount(input.events),
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
      ? {
          id: nearestInterview.id,
          scheduledAt: nearestInterview.scheduledAt,
          prepStatus: nearestInterview.prepStatus,
          round: nearestInterview.round,
        }
      : null,
    deliveryReceipt:
      [...input.events].reverse().find((event) => event.deliveryReceipt !== undefined)
        ?.deliveryReceipt ?? null,
  };
}

/** The first move to `applied` anchors the fixed 5/8-day reminder schedule. */
function applicationAppliedAt(
  application: StoredApplication,
  events: readonly StoredApplicationEvent[],
): string {
  const appliedEvents = events
    .filter((event) => event.kind === 'stage' && event.toStage === 'applied')
    .map((event) => event.occurredAt)
    .sort();
  return appliedEvents[0] ?? application.stageChangedAt;
}

function followUpSentCount(events: readonly StoredApplicationEvent[]): number {
  return events.filter((event) => event.kind === 'follow_up_sent').length;
}

/** "Последнее из событий: отклик, отправленный follow-up, ответ компании" (architecture.md §3). */
function lastContactAt(
  application: StoredApplication,
  events: readonly StoredApplicationEvent[],
): string {
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
  return (
    new Date(interview.scheduledAt).getTime() - new Date(now).getTime() <= INTERVIEW_PREP_WINDOW_MS
  );
}
