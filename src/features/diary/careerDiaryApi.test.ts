import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CareerDiaryAchievementInput, CareerDiaryGoalInput, CareerDiaryMeasurementInput, CareerDiaryWeeklyReviewInput } from '../../../shared/careerDiary';
import { apiFetch, readData } from '../coach/apiClient';
import {
  createCareerDiaryAchievement,
  createCareerDiaryGoal,
  getCareerDiaryWorkplace,
  listCareerDiaryGoals,
  recordCareerDiaryMeasurement,
  setCareerDiaryAchievementStatus,
  updateCareerDiaryGoal,
  updateCareerDiaryWorkplace,
  upsertCareerDiaryReview,
} from './careerDiaryApi';

vi.mock('../coach/apiClient', () => ({
  apiFetch: vi.fn(),
  readData: vi.fn(),
}));

const goalInput: CareerDiaryGoalInput = {
  title: 'Снизить число инцидентов P1',
  type: 'operational',
  horizon: 'quarter',
  startDate: '2026-01-01',
  dueDate: '2026-12-31',
  unit: 'инцидентов в месяц',
  baselineValue: 9,
  targetValue: 4,
};

const measurementInput: CareerDiaryMeasurementInput = {
  value: 8,
  measuredAt: '2026-12-01',
  note: 'Замер за ноябрь',
};

describe('career diary API client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(apiFetch).mockResolvedValue(new Response());
    vi.mocked(readData).mockResolvedValue({ items: [], nextCursor: null });
  });

  it('uses the candidate diary endpoint and opaque cursor for goal pages', async () => {
    await listCareerDiaryGoals({ limit: 20, cursor: 'opaque/cursor +' });

    expect(apiFetch).toHaveBeenCalledWith(
      '/api/v1/candidate/career-diary/goals?limit=20&cursor=opaque%2Fcursor+%2B',
      expect.objectContaining({ signal: undefined }),
    );
  });

  it('uses a fresh idempotency key when creating a goal', async () => {
    await createCareerDiaryGoal(goalInput);

    expect(apiFetch).toHaveBeenCalledWith(
      '/api/v1/candidate/career-diary/goals',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'Idempotency-Key': expect.any(String),
        }),
        body: JSON.stringify(goalInput),
      }),
    );
  });

  it('sends candidate-entered measurements through the goal-scoped endpoint', async () => {
    await recordCareerDiaryMeasurement('goal-id', measurementInput);

    expect(apiFetch).toHaveBeenCalledWith(
      '/api/v1/candidate/career-diary/goals/goal-id/measurements',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'Idempotency-Key': expect.any(String) }),
        body: JSON.stringify(measurementInput),
      }),
    );
    expect(readData).toHaveBeenCalledOnce();
  });

  it('upserts a weekly review by its Monday date', async () => {
    const input: CareerDiaryWeeklyReviewInput = {
      weekStart: '2026-10-05',
      movedForward: 'Согласовал план.',
      blockers: 'Не было данных.',
      learning: 'Нужно сверять источник.',
      risks: 'Сроки.',
      nextWeek: 'Получить подтверждение.',
    };

    await upsertCareerDiaryReview(input.weekStart, input);

    expect(apiFetch).toHaveBeenCalledWith(
      '/api/v1/candidate/career-diary/reviews/2026-10-05',
      expect.objectContaining({ method: 'PUT', body: JSON.stringify(input) }),
    );
  });

  it('creates an achievement with an idempotency key', async () => {
    const input: CareerDiaryAchievementInput = {
      situation: 'Не хватало данных.',
      action: 'Собрал отчёт.',
      result: 'Решение принято.',
    };

    await createCareerDiaryAchievement(input);

    expect(apiFetch).toHaveBeenCalledWith(
      '/api/v1/candidate/career-diary/achievements',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'Idempotency-Key': expect.any(String) }),
        body: JSON.stringify(input),
      }),
    );
  });

  it('changes an achievement status at its candidate-scoped endpoint', async () => {
    await setCareerDiaryAchievementStatus('achievement-1', 'dismissed');

    expect(apiFetch).toHaveBeenCalledWith(
      '/api/v1/candidate/career-diary/achievements/achievement-1',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ status: 'dismissed' }) }),
    );
  });

  it('loads and updates the candidate-scoped workplace planning payload', async () => {
    const planning = { adaptationPlan: null };
    const signal = new AbortController().signal;

    await getCareerDiaryWorkplace('workplace id/one', signal);
    await updateCareerDiaryWorkplace('workplace id/one', { planning });

    expect(apiFetch).toHaveBeenCalledWith(
      '/api/v1/candidate/career-diary/workplaces/workplace%20id%2Fone',
      expect.objectContaining({ signal }),
    );
    expect(apiFetch).toHaveBeenCalledWith(
      '/api/v1/candidate/career-diary/workplaces/workplace%20id%2Fone',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ planning }) }),
    );
  });

  it('persists a quarter decision through the existing goal patch route', async () => {
    const patch = {
      horizon: 'next_quarter' as const,
      dueDate: '2027-03-31',
      quarterDecision: { quarterId: 'Q4 2026', decision: 'move' as const, decidedAt: '2026-12-06' },
    };

    await updateCareerDiaryGoal('goal-1', patch);

    expect(apiFetch).toHaveBeenCalledWith(
      '/api/v1/candidate/career-diary/goals/goal-1',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify(patch) }),
    );
  });
});
