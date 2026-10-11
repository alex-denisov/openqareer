// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CareerDiaryGoalSummary,
  CareerDiaryMeasurement,
  CareerDiaryOverview,
} from '../../../shared/careerDiary';
import { CareerDiaryPage } from './CareerDiaryPage';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const diaryApi = vi.hoisted(() => ({
  getCareerDiaryOverview: vi.fn(),
  listCareerDiaryGoals: vi.fn(),
  getCareerDiaryGoal: vi.fn(),
  listCareerDiaryMeasurements: vi.fn(),
  listCareerDiaryReviews: vi.fn(),
  listCareerDiaryAchievements: vi.fn(),
  getCareerDiaryWorkplace: vi.fn(),
  updateCareerDiaryWorkplace: vi.fn(),
  createCareerDiaryGoal: vi.fn(),
  updateCareerDiaryGoal: vi.fn(),
  deleteCareerDiaryGoal: vi.fn(),
  recordCareerDiaryMeasurement: vi.fn(),
}));

vi.mock('./careerDiaryApi', () => diaryApi);

const riskyGoal: CareerDiaryGoalSummary = {
  id: 'goal-1',
  title: 'Снизить число инцидентов P1',
  type: 'operational',
  horizon: 'quarter',
  startDate: '2026-01-01',
  dueDate: '2026-12-31',
  unit: 'инцидентов в месяц',
  baselineValue: 9,
  targetValue: 4,
  valueSource: 'candidate_entered',
  parentGoalId: null,
  isPrimary: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-12-01T00:00:00.000Z',
  latestMeasurement: {
    id: 'measurement-1',
    goalId: 'goal-1',
    value: 9,
    measuredAt: '2026-12-01',
    note: null,
    source: 'candidate_entered',
    createdAt: '2026-12-01T12:00:00.000Z',
  },
  risk: {
    status: 'at_risk',
    rule: 'linear_progress_v1',
    actualValue: 9,
    expectedValue: 4.1,
    explanation: 'По вашим замерам цель не достигается в срок.',
  },
};

const overview: CareerDiaryOverview = {
  asOf: '2026-12-02',
  primaryWorkplace: null,
  summary: {
    goalsAchieved: 0,
    goalsAtRisk: 1,
    goalsTotal: 1,
    achievementsReadyToAdd: 0,
    weeklyReviewsTotal: 0,
    weeklyReviewsInRow: 0,
  },
};

const measurement: CareerDiaryMeasurement = {
  id: 'measurement-1',
  goalId: 'goal-1',
  value: 9,
  measuredAt: '2026-12-01',
  note: 'Замер кандидата',
  source: 'candidate_entered',
  createdAt: '2026-12-01T12:00:00.000Z',
};

function page<T>(items: readonly T[]) {
  return { items, nextCursor: null };
}

describe('CareerDiaryPage goals', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    diaryApi.getCareerDiaryOverview.mockResolvedValue(overview);
    diaryApi.listCareerDiaryGoals.mockResolvedValue(page([riskyGoal]));
    diaryApi.getCareerDiaryGoal.mockResolvedValue(riskyGoal);
    diaryApi.listCareerDiaryMeasurements.mockResolvedValue(page([measurement]));
    diaryApi.listCareerDiaryReviews.mockResolvedValue(page([]));
    diaryApi.listCareerDiaryAchievements.mockResolvedValue(page([]));
    diaryApi.updateCareerDiaryGoal.mockResolvedValue(riskyGoal);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  async function renderPage() {
    await act(async () => {
      root.render(<CareerDiaryPage onOpenConsultant={vi.fn()} />);
    });
  }

  function buttonNamed(pattern: RegExp | string): HTMLButtonElement {
    const button = Array.from(host.querySelectorAll('button')).find((item) => {
      const label = item.textContent ?? '';
      return typeof pattern === 'string' ? label.includes(pattern) : pattern.test(label);
    });
    if (!button) throw new Error(`Не найдена кнопка: ${pattern.toString()}`);
    return button;
  }

  it('loads candidate goals and shows risk from the API explanation', async () => {
    await renderPage();

    expect(host.textContent).toContain('Цели и KPI');
    expect(buttonNamed(/снизить число инцидентов p1/i)).not.toBeNull();
    expect(host.textContent).toContain('Под риском');
  });

  it('shows quarter results and persists the candidate keep decision', async () => {
    await renderPage();

    await act(async () => buttonNamed('Анализ квартала').click());
    expect(host.textContent).toContain('Итоги Q4 2026');
    expect(host.textContent).toContain('Целей достигнуто');
    expect(host.textContent).toContain('Насколько можно верить расчёту');

    await act(async () => buttonNamed('Оставить в Q4').click());
    expect(diaryApi.updateCareerDiaryGoal).toHaveBeenCalledWith('goal-1', expect.objectContaining({
      quarterDecision: { quarterId: 'Q4 2026', decision: 'keep', decidedAt: '2026-12-02' },
    }));
  });

  it('opens a goal detail with its data-backed chart and measurement history', async () => {
    await renderPage();

    await act(async () => buttonNamed(/снизить число инцидентов p1/i).click());

    const chart = host.querySelector('svg[role="img"]');
    expect(chart?.getAttribute('aria-label')).toMatch(/число инцидентов p1/i);
    expect(host.textContent).toContain('История замеров');
    expect(host.textContent).toContain('Замер кандидата');
    expect(host.textContent).toContain('По вашим замерам цель не достигается в срок.');
  });

  it('opens an empty goal form and explains required fields before saving', async () => {
    await renderPage();

    await act(async () => buttonNamed('Добавить цель').click());
    expect(host.querySelector('dialog[aria-labelledby="career-diary-goal-form-title"]')).not.toBeNull();
    await act(async () => buttonNamed('Сохранить цель').click());

    expect(host.textContent).toContain('Укажите название цели.');
    expect(diaryApi.createCareerDiaryGoal).not.toHaveBeenCalled();
  });
});
