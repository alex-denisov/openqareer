import type { ReasonedCareerAction } from '../next-action/careerActionPolicy';
import type { CareerCabinetView } from '../cabinet/cabinetViews';
import { selectTodayDecision, type TodaySnapshot } from './todayApi';
import { queueActionTitle } from './todayFormat';

export interface TodayDiaryDecisionProp {
  readonly action: ReasonedCareerAction;
  readonly onPostpone: () => void;
}

export interface TodayDecisionOverride {
  readonly action: ReasonedCareerAction;
  readonly onAccept: () => void;
  readonly onPostpone: () => void;
}

/**
 * Решение дня, которое важнее предложения консультанта: напоминание, выбранное
 * в очереди, затем разбор недели из карьерного дневника.
 */
export function todayDecisionOverride(
  snapshot: TodaySnapshot,
  props: {
    readonly diaryDecision?: TodayDiaryDecisionProp;
    readonly onNavigate?: (view: CareerCabinetView) => void;
    readonly onRetry: () => void;
  },
): TodayDecisionOverride | undefined {
  const selected = selectedDecisionAction(snapshot);
  if (selected) {
    return {
      action: selected,
      onAccept: () => props.onNavigate?.('responses'),
      onPostpone: () => {
        void selectTodayDecision(snapshot.todayDecisionSelection!.applicationId, 'dismissed').catch(
          () => props.onRetry(),
        );
      },
    };
  }
  if (!props.diaryDecision) return undefined;
  return {
    action: props.diaryDecision.action,
    onAccept: () => props.onNavigate?.('diary'),
    onPostpone: props.diaryDecision.onPostpone,
  };
}

function selectedDecisionAction(snapshot: TodaySnapshot): ReasonedCareerAction | undefined {
  if (snapshot.todayDecisionSelection?.resolution !== 'accepted') return undefined;
  const item = snapshot.queue.find(
    (entry) =>
      entry.applicationId === snapshot.todayDecisionSelection?.applicationId &&
      entry.kind === 'follow_up',
  );
  if (!item) return undefined;
  return {
    revision: 'career-action-policy-v1-2026-08-07',
    type: 'decision',
    destination: 'coach',
    headline: queueActionTitle(item),
    label: 'Открыть отклик',
    rationale: item.eyebrow ?? 'Задача из вашей очереди дня.',
    expectedChange: 'Откроются отклики, чтобы подготовить напоминание.',
    findingIds: [],
    roleIds: [],
    marketIds: [],
    alternatives: [],
    approvalBoundary: 'Напоминание отправляется только после вашего подтверждения.',
  };
}
