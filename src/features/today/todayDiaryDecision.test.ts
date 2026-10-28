import { describe, expect, it } from 'vitest';
import type { CareerDiaryOverview, CareerDiaryWeeklyReview } from '../../../shared/careerDiary';
import { actionSourceSummary } from './TodayDesktop';
import { todayDiaryDecision } from './todayDiaryDecision';

const workplace = {
  id: 'w1',
  company: 'Финтех Лаб',
  title: 'Head of Engineering',
  startDate: '2026-09-07',
  endDate: null,
  sourceExperienceId: null,
  status: 'active' as const,
  isPrimary: true,
  createdAt: '2026-09-07T00:00:00.000Z',
  updatedAt: '2026-09-07T00:00:00.000Z',
};

function overview(patch: Partial<CareerDiaryOverview> = {}): CareerDiaryOverview {
  return {
    asOf: '2026-10-07',
    platformStartedAt: '2026-09-07',
    primaryWorkplace: workplace,
    summary: {
      goalsAchieved: 0,
      goalsAtRisk: 1,
      goalsTotal: 3,
      achievementsReadyToAdd: 0,
      weeklyReviewsTotal: 4,
      weeklyReviewsInRow: 4,
    },
    ...patch,
  };
}

const review = (weekStart: string) => ({ weekStart }) as CareerDiaryWeeklyReview;

describe('todayDiaryDecision (макет 1 «Вы работаете: решение дня из дневника»)', () => {
  it('asks for the current week review with the week number and goals at risk', () => {
    const decision = todayDiaryDecision(overview(), review('2026-09-28'));
    expect(decision?.headline).toBe('Разбор недели 5');
    expect(decision?.expectedChange).toBe(
      '1 цель под риском; нужен ваш вывод на следующую неделю. Займёт около 5 минут.',
    );
    expect(decision?.label).toBe('Открыть карьерный дневник');
    expect(decision && actionSourceSummary(decision)).toBe('карьерный дневник');
  });

  it('counts weeks from the start on the platform, not from the start of the job', () => {
    const longJob = { ...workplace, startDate: '2024-01-08' };
    const decision = todayDiaryDecision(
      overview({ primaryWorkplace: longJob, platformStartedAt: '2026-10-01' }),
      null,
    );
    expect(decision?.headline).toBe('Разбор недели 2');
    expect(
      todayDiaryDecision(overview({ primaryWorkplace: longJob, platformStartedAt: null }), null)
        ?.headline,
    ).toBe('Разбор недели');
  });

  it('is silent once this week is reviewed or without an active workplace', () => {
    expect(todayDiaryDecision(overview(), review('2026-10-05'))).toBeNull();
    expect(todayDiaryDecision(overview({ primaryWorkplace: null }), null)).toBeNull();
    expect(
      todayDiaryDecision(
        overview({ primaryWorkplace: { ...workplace, status: 'archived' } }),
        null,
      ),
    ).toBeNull();
  });

  it('omits the risk clause when no goal is at risk', () => {
    const calm = overview({ summary: { ...overview().summary, goalsAtRisk: 0 } });
    expect(todayDiaryDecision(calm, null)?.expectedChange).toBe(
      'Нужен ваш вывод на следующую неделю. Займёт около 5 минут.',
    );
  });
});
