import { describe, expect, it, vi } from 'vitest';
import type { TodaySnapshot } from './todayApi';
import { todayDecisionOverride } from './todayDecisionOverride';
import type { ReasonedCareerAction } from '../next-action/careerActionPolicy';

vi.mock('./todayApi', () => ({ selectTodayDecision: vi.fn(async () => undefined) }));

const diaryAction = { headline: 'Разбор недели 5' } as ReasonedCareerAction;
const snapshot = { queue: [], followUps: [] } as unknown as TodaySnapshot;

describe('todayDecisionOverride', () => {
  it('opens the career diary for the diary decision and postpones it locally', () => {
    const onNavigate = vi.fn();
    const onPostpone = vi.fn();
    const override = todayDecisionOverride(snapshot, {
      diaryDecision: { action: diaryAction, onPostpone },
      onNavigate,
      onRetry: vi.fn(),
    });
    expect(override?.action).toBe(diaryAction);
    override?.onAccept();
    expect(onNavigate).toHaveBeenCalledWith('diary');
    override?.onPostpone();
    expect(onPostpone).toHaveBeenCalledOnce();
  });

  it('prefers a reminder the candidate picked in the queue', () => {
    const picked = {
      queue: [{ kind: 'follow_up', applicationId: 'a1', company: 'Вектор Банк', title: 'CTO' }],
      followUps: [],
      todayDecisionSelection: { applicationId: 'a1', resolution: 'accepted' },
    } as unknown as TodaySnapshot;
    const onNavigate = vi.fn();
    const override = todayDecisionOverride(picked, {
      diaryDecision: { action: diaryAction, onPostpone: vi.fn() },
      onNavigate,
      onRetry: vi.fn(),
    });
    expect(override?.action.label).toBe('Открыть отклик');
    override?.onAccept();
    expect(onNavigate).toHaveBeenCalledWith('responses');
  });

  it('leaves the consultant decision alone without overrides', () => {
    expect(todayDecisionOverride(snapshot, { onRetry: vi.fn() })).toBeUndefined();
  });
});
