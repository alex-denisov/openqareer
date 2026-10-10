import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CareerDiaryGoalInput, CareerDiaryMeasurementInput } from '../../../shared/careerDiary';
import { apiFetch, readData } from '../coach/apiClient';
import {
  createCareerDiaryGoal,
  listCareerDiaryGoals,
  recordCareerDiaryMeasurement,
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
});
