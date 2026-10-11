export type CareerDiaryValue = number | boolean | string;
export type CareerDiaryGoalType = 'operational' | 'team' | 'strategic' | 'development';
export type CareerDiaryHorizon = 'quarter' | 'next_quarter' | 'year';
export type CareerDiaryValueSource = 'candidate_entered';

export interface CareerDiaryGoal {
  readonly id: string;
  readonly title: string;
  readonly type: CareerDiaryGoalType;
  readonly horizon: CareerDiaryHorizon;
  readonly startDate: string;
  readonly dueDate: string;
  readonly unit: string;
  readonly baselineValue: number | null;
  readonly targetValue: CareerDiaryValue;
  readonly valueSource: CareerDiaryValueSource;
  readonly parentGoalId: string | null;
  readonly isPrimary: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CareerDiaryMeasurement {
  readonly id: string;
  readonly goalId: string;
  readonly value: CareerDiaryValue;
  readonly measuredAt: string;
  readonly note: string | null;
  readonly source: CareerDiaryValueSource;
  readonly createdAt: string;
}

export type CareerDiaryGoalRiskStatus = 'planned' | 'on_track' | 'at_risk' | 'achieved' | 'unknown';
export type CareerDiaryGoalRiskRule =
  | 'linear_progress_v1'
  | 'target_reached'
  | 'measurement_required'
  | 'non_numeric_goal'
  | 'invalid_period';

export interface CareerDiaryGoalRisk {
  readonly status: CareerDiaryGoalRiskStatus;
  readonly rule: CareerDiaryGoalRiskRule;
  readonly explanation: string;
  readonly expectedValue?: number;
  readonly actualValue?: number;
}

export interface CareerDiaryWeeklyReview {
  readonly weekStart: string;
  readonly movedForward: string;
  readonly blockers: string;
  readonly learning: string;
  readonly risks: string;
  readonly nextWeek: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type CareerDiaryAchievementStatus = 'ready_to_add' | 'dismissed';

export interface CareerDiaryAchievement {
  readonly id: string;
  readonly situation: string;
  readonly action: string;
  readonly result: string;
  readonly status: CareerDiaryAchievementStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type CareerDiaryWorkplaceStatus = 'active' | 'archived';

export interface CareerDiaryWorkplace {
  readonly id: string;
  readonly company: string;
  readonly title: string;
  readonly startDate: string;
  readonly endDate: string | null;
  readonly sourceExperienceId: string | null;
  readonly status: CareerDiaryWorkplaceStatus;
  readonly isPrimary: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type CareerDiaryGoalInput = Omit<
  CareerDiaryGoal,
  'id' | 'valueSource' | 'parentGoalId' | 'isPrimary' | 'createdAt' | 'updatedAt'
> & {
  readonly parentGoalId?: string | null;
};

export type CareerDiaryGoalPatch = Partial<
  Pick<CareerDiaryGoal, 'title' | 'type' | 'horizon' | 'startDate' | 'dueDate' | 'unit' | 'baselineValue' | 'targetValue' | 'parentGoalId'>
>;

export interface CareerDiaryMeasurementInput {
  readonly value: CareerDiaryValue;
  readonly measuredAt: string;
  readonly note?: string | null;
}

export type CareerDiaryWeeklyReviewInput = Omit<
  CareerDiaryWeeklyReview,
  'createdAt' | 'updatedAt'
>;

export type CareerDiaryAchievementInput = Omit<
  CareerDiaryAchievement,
  'id' | 'status' | 'createdAt' | 'updatedAt'
>;

export interface CareerDiaryWorkplaceInput {
  readonly company: string;
  readonly title: string;
  readonly startDate: string;
  readonly endDate?: string | null;
  readonly sourceExperienceId?: string | null;
}

export type CareerDiaryWorkplacePatch = Partial<CareerDiaryWorkplaceInput>;

export type CareerDiaryGoalSummary = CareerDiaryGoal & {
  readonly latestMeasurement: CareerDiaryMeasurement | null;
  readonly risk: CareerDiaryGoalRisk;
};

export interface CareerDiaryPage<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
}

export interface CareerDiaryOverview {
  readonly asOf: string;
  readonly primaryWorkplace: CareerDiaryWorkplace | null;
  readonly summary: {
    readonly goalsAchieved: number;
    readonly goalsAtRisk: number;
    readonly goalsTotal: number;
    readonly achievementsReadyToAdd: number;
    readonly weeklyReviewsTotal: number;
    readonly weeklyReviewsInRow: number;
  };
}

function utcDate(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return null;
  const timestamp = Date.parse(value + 'T00:00:00.000Z');
  return Number.isFinite(timestamp) ? timestamp : null;
}

function reachedTarget(current: CareerDiaryValue, target: CareerDiaryValue, baseline: number | null): boolean {
  if (typeof current !== 'number' || typeof target !== 'number' || baseline === null) {
    return current === target;
  }
  return target >= baseline ? current >= target : current <= target;
}

export function evaluateCareerGoalRisk(
  goal: Pick<CareerDiaryGoal, 'baselineValue' | 'targetValue' | 'startDate' | 'dueDate' | 'unit'>,
  latest: Pick<CareerDiaryMeasurement, 'value' | 'measuredAt'> | null,
  asOf: string,
): CareerDiaryGoalRisk {
  if (!latest) {
    return {
      status: 'unknown',
      rule: 'measurement_required',
      explanation: 'Замеров пока нет; риск по цели не рассчитывается.',
    };
  }
  if (
    typeof latest.value !== 'number' ||
    typeof goal.targetValue !== 'number' ||
    goal.baselineValue === null
  ) {
    if (reachedTarget(latest.value, goal.targetValue, goal.baselineValue)) {
      return {
        status: 'achieved',
        rule: 'target_reached',
        explanation: 'Последнее значение достигло заданной цели.',
      };
    }
    return {
      status: 'unknown',
      rule: 'non_numeric_goal',
      explanation: 'Для этой цели числового сравнения нет; риск не рассчитывается.',
    };
  }
  const start = utcDate(goal.startDate);
  const due = utcDate(goal.dueDate);
  const asOfDate = utcDate(asOf);
  const measuredAt = utcDate(latest.measuredAt);
  if (
    start === null ||
    due === null ||
    asOfDate === null ||
    measuredAt === null ||
    due <= start ||
    measuredAt < start ||
    measuredAt > asOfDate ||
    goal.targetValue === goal.baselineValue
  ) {
    return {
      status: 'unknown',
      rule: 'invalid_period',
      explanation: 'Нужны корректные даты и разные исходное и целевое значения.',
    };
  }
  const current = latest.value;
  if (reachedTarget(current, goal.targetValue, goal.baselineValue)) {
    return {
      status: 'achieved',
      rule: 'target_reached',
      explanation: 'Последнее значение достигло заданной цели.',
      actualValue: current,
    };
  }
  const elapsed = Math.max(0, Math.min(1, (asOfDate - start) / (due - start)));
  const expectedValue = goal.baselineValue + (goal.targetValue - goal.baselineValue) * elapsed;
  const progress = (current - goal.baselineValue) / (goal.targetValue - goal.baselineValue);
  const expected = Math.round(expectedValue * 100) / 100;
  const status = progress < elapsed ? 'at_risk' : 'on_track';
  return {
    status,
    rule: 'linear_progress_v1',
    explanation:
      'По линейному плану на ' + asOf + ': ожидаем ' + expected + ' ' + goal.unit +
      ', последнее значение — ' + current + ' ' + goal.unit + '.',
    expectedValue: expected,
    actualValue: current,
  };
}
