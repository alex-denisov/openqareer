import type { CandidateNotification } from '../notifications/notificationsApi';

export type DesktopNotificationTarget = 'opportunities' | 'responses' | 'notifications';

export interface DesktopNotificationNotice {
  readonly ids: readonly string[];
  readonly title: string;
  readonly body: string;
  readonly target: DesktopNotificationTarget;
}

export interface DesktopNotificationCheckpoint {
  readonly enabled: boolean;
  readonly enabledAt: string | null;
  readonly lastPollAt: string | null;
  readonly seenIds: readonly string[];
}

export interface DesktopNotificationPlan {
  readonly notices: readonly DesktopNotificationNotice[];
}

export function planDesktopNotificationBatch(
  items: readonly CandidateNotification[],
  checkpoint: DesktopNotificationCheckpoint,
  isDesktop: boolean,
  now: string,
): DesktopNotificationPlan {
  if (!isDesktop || !checkpoint.enabled) return { notices: [] };

  const boundary = Date.parse(checkpoint.lastPollAt ?? checkpoint.enabledAt ?? now);
  const seen = new Set(checkpoint.seenIds);
  const fresh = items
    .filter(
      (item) => isEligible(item) && !seen.has(item.id) && Date.parse(item.createdAt) >= boundary,
    )
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
  const individual = fresh.slice(0, 3).map(toNotice);
  const overflow = fresh.slice(3);
  return {
    notices:
      overflow.length > 0
        ? [...individual, summaryNotice(overflow.map((item) => item.id))]
        : individual,
  };
}

function isEligible(item: CandidateNotification): boolean {
  return (
    item.readAt === null &&
    (item.kind === 'new_vacancies_by_role' || item.kind === 'employer_reply')
  );
}

function toNotice(item: CandidateNotification): DesktopNotificationNotice {
  return item.kind === 'employer_reply'
    ? {
        ids: [item.id],
        title: 'Ответ работодателя',
        body: 'В отклике появился новый ответ работодателя.',
        target: 'responses',
      }
    : {
        ids: [item.id],
        title: 'Новые подходящие вакансии',
        body: 'В подборке появились вакансии по выбранной роли.',
        target: 'opportunities',
      };
}

function summaryNotice(ids: readonly string[]): DesktopNotificationNotice {
  return {
    ids,
    title: 'OpenQareer',
    body: `Ещё ${ids.length} новых событий.`,
    target: 'notifications',
  };
}
