import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  evaluateCareerGoalRisk,
  type CareerDiaryAchievement,
  type CareerDiaryAchievementInput,
  type CareerDiaryAchievementStatus,
  type CareerDiaryGoal,
  type CareerDiaryGoalInput,
  type CareerDiaryGoalPatch,
  type CareerDiaryGoalSummary,
  type CareerDiaryMeasurement,
  type CareerDiaryMeasurementInput,
  type CareerDiaryOverview,
  type CareerDiaryPage,
  type CareerDiaryWeeklyReview,
  type CareerDiaryWeeklyReviewInput,
  type CareerDiaryWorkplace,
  type CareerDiaryWorkplaceInput,
  type CareerDiaryWorkplacePatch,
} from '../../shared/careerDiary';
import type { SealedText } from './sealedText';
import {
  openPayload,
  pagePayloadRows,
  sealPayload,
  type MeasurementRow,
  type PayloadRow,
  type WeeklyReviewRow,
} from './careerDiaryRepositoryHelpers';
export { InvalidCareerDiaryCursorError } from './careerDiaryRepositoryHelpers';
import { MIGRATION_44 } from './careerDiarySchema';

type InTransaction = <T>(operation: () => T) => T;

function weeklyReviewStreak(reviews: readonly CareerDiaryWeeklyReview[]): number {
  if (reviews.length === 0) return 0;
  let streak = 1;
  for (let index = 1; index < reviews.length; index += 1) {
    const current = Date.parse(reviews[index - 1]!.weekStart + 'T00:00:00.000Z');
    const previous = Date.parse(reviews[index]!.weekStart + 'T00:00:00.000Z');
    if (current - previous !== 7 * 24 * 60 * 60 * 1000) break;
    streak += 1;
  }
  return streak;
}

export class CareerDiaryIdempotencyConflictError extends Error {
  constructor() {
    super('idempotency key was already used with a different request');
    this.name = 'CareerDiaryIdempotencyConflictError';
  }
}

function sameGoalInput(goal: CareerDiaryGoal, input: CareerDiaryGoalInput, parentGoalId: string | null): boolean {
  return goal.title === input.title &&
    goal.type === input.type &&
    goal.horizon === input.horizon &&
    goal.startDate === input.startDate &&
    goal.dueDate === input.dueDate &&
    goal.unit === input.unit &&
    goal.baselineValue === input.baselineValue &&
    goal.targetValue === input.targetValue &&
    goal.parentGoalId === parentGoalId;
}

function sameMeasurementInput(
  measurement: CareerDiaryMeasurement,
  goalId: string,
  input: CareerDiaryMeasurementInput,
): boolean {
  return measurement.goalId === goalId &&
    measurement.value === input.value &&
    measurement.measuredAt === input.measuredAt &&
    measurement.note === (input.note ?? null);
}

export class SqliteCareerDiaryRepository {
  constructor(
    private readonly database: DatabaseSync,
    private readonly sealedText: SealedText,
    private readonly inTransaction: InTransaction = (operation) => operation(),
  ) {
    this.database.exec(MIGRATION_44);
  }

  saveInterviewPractice(candidateId: string, session: import('../domain/interviewSimulator').InterviewSession): import('../../shared/careerDiary').CareerDiaryInterviewPractice {
    const existing = this.getInterviewPractice(candidateId, session.id);
    if (existing && existing.session.version >= session.version) return existing;
    const now = existing?.createdAt ?? new Date().toISOString();
    const record: import('../../shared/careerDiary').CareerDiaryInterviewPractice = { id: session.id, source: 'mock_interview', session, createdAt: now };
    this.database.prepare('INSERT INTO career_diary_interview_practices(candidate_id,id,payload_cipher,created_at,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(candidate_id,id) DO UPDATE SET payload_cipher=excluded.payload_cipher,updated_at=excluded.updated_at').run(candidateId, session.id, sealPayload(this.sealedText, candidateId, 'interview-practice', session.id, record), now, now);
    return this.getInterviewPractice(candidateId, session.id)!;
  }

  getInterviewPractice(candidateId: string, id: string): import('../../shared/careerDiary').CareerDiaryInterviewPractice | null {
    const row = this.database.prepare('SELECT payload_cipher FROM career_diary_interview_practices WHERE candidate_id = ? AND id = ?').get(candidateId, id) as { payload_cipher: string } | undefined;
    return row ? openPayload(this.sealedText, candidateId, 'interview-practice', id, row.payload_cipher) : null;
  }

  listInterviewPractices(candidateId: string, limit: number, cursor?: string): import('../../shared/careerDiary').CareerDiaryPage<import('../../shared/careerDiary').CareerDiaryInterviewPractice> {
    const page = pagePayloadRows(this.database, 'career_diary_interview_practices', candidateId, limit, cursor, 'created_at');
    return { items: page.rows.map(row => openPayload(this.sealedText, candidateId, 'interview-practice', row.id, row.payload_cipher)), nextCursor: page.nextCursor };
  }

  exportInterviewPractices(candidateId: string): import('../../shared/careerDiary').CareerDiaryInterviewPractice[] {
    const records: import('../../shared/careerDiary').CareerDiaryInterviewPractice[] = [];
    let cursor: string | undefined;
    do {
      const page = this.listInterviewPractices(candidateId, 100, cursor);
      records.push(...page.items);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    return records;
  }

  deleteInterviewPractice(candidateId: string, id: string): boolean {
    return this.database.prepare('DELETE FROM career_diary_interview_practices WHERE candidate_id = ? AND id = ?').run(candidateId, id).changes > 0;
  }

  createGoal(
  candidateId: string,
  input: CareerDiaryGoalInput,
  now = new Date().toISOString(),
  resourceId?: string,
): CareerDiaryGoal {
  const id = resourceId ?? randomUUID();
  const existing = this.getGoal(candidateId, id);
  const parentGoalId = input.parentGoalId ?? null;
  if (existing) {
    if (!sameGoalInput(existing, input, parentGoalId)) {
      throw new CareerDiaryIdempotencyConflictError();
    }
    return existing;
  }
  const goal: CareerDiaryGoal = {
    ...input,
    id,
    parentGoalId,
    isPrimary: false,
    valueSource: 'candidate_entered',
    createdAt: now,
    updatedAt: now,
  };
  this.insertGoal(candidateId, goal);
  return goal;
}

  getGoal(candidateId: string, goalId: string): CareerDiaryGoal | null {
    const row = this.database
      .prepare('SELECT id, payload_cipher FROM career_diary_goals WHERE candidate_id = ? AND id = ?')
      .get(candidateId, goalId) as Pick<PayloadRow, 'id' | 'payload_cipher'> | undefined;
    return row
      ? openPayload<CareerDiaryGoal>(this.sealedText, candidateId, 'goal', row.id, row.payload_cipher)
      : null;
  }

  listGoals(candidateId: string): CareerDiaryGoal[] {
    const rows = this.database
      .prepare('SELECT id, payload_cipher FROM career_diary_goals WHERE candidate_id = ?')
      .all(candidateId) as unknown as Array<Pick<PayloadRow, 'id' | 'payload_cipher'>>;
    return rows
      .map((row) => openPayload<CareerDiaryGoal>(
        this.sealedText,
        candidateId,
        'goal',
        row.id,
        row.payload_cipher,
      ))
      .sort((left, right) => left.dueDate.localeCompare(right.dueDate));
  }

  listGoalsPage(
    candidateId: string,
    limit = 50,
    cursor?: string,
  ): CareerDiaryPage<CareerDiaryGoal> {
    const page = pagePayloadRows(
      this.database,
      'career_diary_goals',
      candidateId,
      limit,
      cursor,
      'created_at',
    );
    return {
      items: page.rows.map((row) => openPayload<CareerDiaryGoal>(
        this.sealedText,
        candidateId,
        'goal',
        row.id,
        row.payload_cipher,
      )),
      nextCursor: page.nextCursor,
    };
  }

  updateGoal(
  candidateId: string,
  goalId: string,
  patch: CareerDiaryGoalPatch,
  now = new Date().toISOString(),
): CareerDiaryGoal | null {
  const current = this.getGoal(candidateId, goalId);
  if (!current) return null;
  const updated = { ...current, ...patch, updatedAt: now };
  if (updated.dueDate < updated.startDate) return null;
  this.writeGoal(candidateId, updated);
  return updated;
}

  deleteGoal(candidateId: string, goalId: string): boolean {
  if (!this.getGoal(candidateId, goalId)) return false;
  return this.inTransaction(() => {
    for (const child of this.listGoals(candidateId).filter((goal) => goal.parentGoalId === goalId)) {
      this.writeGoal(candidateId, { ...child, parentGoalId: null, updatedAt: new Date().toISOString() });
    }
    const result = this.database
      .prepare('DELETE FROM career_diary_goals WHERE candidate_id = ? AND id = ?')
      .run(candidateId, goalId);
    return Number(result.changes) > 0;
  });
}

  setPrimaryGoal(
    candidateId: string,
    goalId: string,
    now = new Date().toISOString(),
  ): CareerDiaryGoal | null {
    if (!this.getGoal(candidateId, goalId)) return null;
    this.inTransaction(() => {
      for (const goal of this.listGoals(candidateId)) {
        this.writeGoal(candidateId, { ...goal, isPrimary: goal.id === goalId, updatedAt: now });
      }
    });
    return this.getGoal(candidateId, goalId);
  }

  splitGoal(
  candidateId: string,
  goalId: string,
  children: readonly CareerDiaryGoalInput[],
  now = new Date().toISOString(),
): CareerDiaryGoal[] | null {
  if (!this.getGoal(candidateId, goalId)) return null;
  return this.inTransaction(() => {
    const existing = this.listGoals(candidateId).filter((goal) => goal.parentGoalId === goalId);
    if (existing.length > 0) {
      const sameChildren = existing.length === children.length &&
        children.every((child) => existing.some((goal) => sameGoalInput(goal, child, goalId)));
      if (!sameChildren) throw new CareerDiaryIdempotencyConflictError();
      return existing;
    }
    return children.map((child) =>
      this.createGoal(candidateId, { ...child, parentGoalId: goalId }, now),
    );
  });
}

  recordMeasurement(
  candidateId: string,
  goalId: string,
  input: CareerDiaryMeasurementInput,
  now = new Date().toISOString(),
  resourceId?: string,
): CareerDiaryMeasurement | null {
  if (!this.getGoal(candidateId, goalId)) return null;
  const id = resourceId ?? randomUUID();
  const existingRow = this.database
    .prepare(
      'SELECT id, payload_cipher FROM career_diary_measurements WHERE candidate_id = ? AND id = ?',
    )
    .get(candidateId, id) as Pick<PayloadRow, 'id' | 'payload_cipher'> | undefined;
  if (existingRow) {
    const existing = openPayload<CareerDiaryMeasurement>(
      this.sealedText,
      candidateId,
      'measurement',
      id,
      existingRow.payload_cipher,
    );
    if (!sameMeasurementInput(existing, goalId, input)) {
      throw new CareerDiaryIdempotencyConflictError();
    }
    return existing;
  }
  const measurement: CareerDiaryMeasurement = {
    id,
    goalId,
    value: input.value,
    measuredAt: input.measuredAt,
    note: input.note ?? null,
    source: 'candidate_entered',
    createdAt: now,
  };
  this.database
    .prepare(
      'INSERT INTO career_diary_measurements (candidate_id, id, goal_id, measured_at, payload_cipher, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .run(
      candidateId,
      measurement.id,
      goalId,
      measurement.measuredAt,
      sealPayload(this.sealedText, candidateId, 'measurement', measurement.id, measurement),
      now,
    );
  return measurement;
}

  getMeasurement(
    candidateId: string,
    goalId: string,
    measurementId: string,
  ): CareerDiaryMeasurement | null {
    const row = this.database
      .prepare(
        'SELECT id, payload_cipher FROM career_diary_measurements WHERE candidate_id = ? AND goal_id = ? AND id = ?',
      )
      .get(candidateId, goalId, measurementId) as Pick<PayloadRow, 'id' | 'payload_cipher'> | undefined;
    return row
      ? openPayload<CareerDiaryMeasurement>(
        this.sealedText,
        candidateId,
        'measurement',
        row.id,
        row.payload_cipher,
      )
      : null;
  }

  listMeasurements(candidateId: string, goalId: string): CareerDiaryMeasurement[] {
    const rows = this.database
      .prepare(
        `SELECT id, goal_id, measured_at, payload_cipher, created_at, created_at AS updated_at
         FROM career_diary_measurements
         WHERE candidate_id = ? AND goal_id = ?`,
      )
      .all(candidateId, goalId) as unknown as MeasurementRow[];
    return rows
      .map((row) => openPayload<CareerDiaryMeasurement>(
        this.sealedText,
        candidateId,
        'measurement',
        row.id,
        row.payload_cipher,
      ))
      .sort((left, right) => right.measuredAt.localeCompare(left.measuredAt));
  }

  listMeasurementsPage(
    candidateId: string,
    goalId: string,
    limit = 50,
    cursor?: string,
  ): CareerDiaryPage<CareerDiaryMeasurement> {
    const page = pagePayloadRows(
      this.database,
      'career_diary_measurements',
      candidateId,
      limit,
      cursor,
      'measured_at',
      goalId,
    );
    return {
      items: page.rows.map((row) => openPayload<CareerDiaryMeasurement>(
        this.sealedText,
        candidateId,
        'measurement',
        row.id,
        row.payload_cipher,
      )),
      nextCursor: page.nextCursor,
    };
  }

  upsertWeeklyReview(
    candidateId: string,
    input: CareerDiaryWeeklyReviewInput,
    now = new Date().toISOString(),
  ): CareerDiaryWeeklyReview {
    const previous = this.getWeeklyReview(candidateId, input.weekStart);
    const review: CareerDiaryWeeklyReview = {
      ...input,
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
    };
    this.database
      .prepare(
        `INSERT INTO career_diary_weekly_reviews
          (candidate_id, week_start, payload_cipher, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(candidate_id, week_start) DO UPDATE SET
           payload_cipher = excluded.payload_cipher,
           updated_at = excluded.updated_at`,
      )
      .run(
        candidateId,
        input.weekStart,
        sealPayload(this.sealedText, candidateId, 'weekly-review', input.weekStart, review),
        review.createdAt,
        now,
      );
    return review;
  }

  getWeeklyReview(candidateId: string, weekStart: string): CareerDiaryWeeklyReview | null {
    const row = this.database
      .prepare(
        `SELECT week_start, payload_cipher, created_at, updated_at
         FROM career_diary_weekly_reviews
         WHERE candidate_id = ? AND week_start = ?`,
      )
      .get(candidateId, weekStart) as WeeklyReviewRow | undefined;
    return row
      ? openPayload<CareerDiaryWeeklyReview>(
        this.sealedText,
        candidateId,
        'weekly-review',
        row.week_start,
        row.payload_cipher,
      )
      : null;
  }

  listWeeklyReviews(candidateId: string, limit = 52): CareerDiaryWeeklyReview[] {
    const rows = this.database
      .prepare(
        `SELECT week_start, payload_cipher, created_at, updated_at
         FROM career_diary_weekly_reviews
         WHERE candidate_id = ?
         ORDER BY week_start DESC
         LIMIT ?`,
      )
      .all(candidateId, Math.max(1, Math.min(limit, 104))) as unknown as WeeklyReviewRow[];
    return rows.map((row) =>
      openPayload<CareerDiaryWeeklyReview>(
        this.sealedText,
        candidateId,
        'weekly-review',
        row.week_start,
        row.payload_cipher,
      ),
    );
  }

  listWeeklyReviewsPage(
    candidateId: string,
    limit = 26,
    cursor?: string,
  ): CareerDiaryPage<CareerDiaryWeeklyReview> {
    const page = pagePayloadRows(
      this.database,
      'career_diary_weekly_reviews',
      candidateId,
      limit,
      cursor,
      'week_start',
    );
    return {
      items: page.rows.map((row) => openPayload<CareerDiaryWeeklyReview>(
        this.sealedText,
        candidateId,
        'weekly-review',
        row.week_start ?? row.id,
        row.payload_cipher,
      )),
      nextCursor: page.nextCursor,
    };
  }

  deleteWeeklyReview(candidateId: string, weekStart: string): boolean {
    const result = this.database
      .prepare(
        'DELETE FROM career_diary_weekly_reviews WHERE candidate_id = ? AND week_start = ?',
      )
      .run(candidateId, weekStart);
    return Number(result.changes) > 0;
  }

  createAchievement(
  candidateId: string,
  input: CareerDiaryAchievementInput,
  now = new Date().toISOString(),
  resourceId?: string,
): CareerDiaryAchievement {
  const id = resourceId ?? randomUUID();
  const existing = this.getAchievement(candidateId, id);
  if (existing) {
    if (
      existing.situation !== input.situation ||
      existing.action !== input.action ||
      existing.result !== input.result
    ) throw new CareerDiaryIdempotencyConflictError();
    return existing;
  }
  const achievement: CareerDiaryAchievement = {
    ...input,
    id,
    status: 'ready_to_add',
    createdAt: now,
    updatedAt: now,
  };
  this.insertAchievement(candidateId, achievement);
  return achievement;
}

  listAchievements(candidateId: string): CareerDiaryAchievement[] {
    const rows = this.payloadRows('career_diary_achievements', candidateId);
    return rows.map((row) =>
      openPayload<CareerDiaryAchievement>(
        this.sealedText,
        candidateId,
        'achievement',
        row.id,
        row.payload_cipher,
      ),
    ).sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  listAchievementsPage(
    candidateId: string,
    limit = 50,
    cursor?: string,
  ): CareerDiaryPage<CareerDiaryAchievement> {
    const page = pagePayloadRows(
      this.database,
      'career_diary_achievements',
      candidateId,
      limit,
      cursor,
      'created_at',
    );
    return {
      items: page.rows.map((row) => openPayload<CareerDiaryAchievement>(
        this.sealedText,
        candidateId,
        'achievement',
        row.id,
        row.payload_cipher,
      )),
      nextCursor: page.nextCursor,
    };
  }

  setAchievementStatus(
    candidateId: string,
    achievementId: string,
    status: CareerDiaryAchievementStatus,
    now = new Date().toISOString(),
  ): CareerDiaryAchievement | null {
    const achievement = this.getAchievement(candidateId, achievementId);
    if (!achievement) return null;
    const updated = { ...achievement, status, updatedAt: now };
    this.writeAchievement(candidateId, updated);
    return updated;
  }

  createWorkplace(
  candidateId: string,
  input: CareerDiaryWorkplaceInput,
  now = new Date().toISOString(),
  resourceId?: string,
): CareerDiaryWorkplace {
  return this.inTransaction(() => {
    const id = resourceId ?? randomUUID();
    const existing = this.getWorkplace(candidateId, id);
    if (existing) {
      if (
        existing.company !== input.company ||
        existing.title !== input.title ||
        existing.startDate !== input.startDate ||
        existing.endDate !== (input.endDate ?? null) ||
        existing.sourceExperienceId !== (input.sourceExperienceId ?? null)
      ) throw new CareerDiaryIdempotencyConflictError();
      return existing;
    }
    const isPrimary = !input.endDate && this.listWorkplaces(candidateId).every((item) => !item.isPrimary);
    const workplace: CareerDiaryWorkplace = {
      id,
      company: input.company,
      title: input.title,
      startDate: input.startDate,
      endDate: input.endDate ?? null,
      sourceExperienceId: input.sourceExperienceId ?? null,
      status: input.endDate ? 'archived' : 'active',
      isPrimary,
      createdAt: now,
      updatedAt: now,
    };
    this.insertWorkplace(candidateId, workplace);
    return workplace;
  });
}

  listWorkplaces(candidateId: string): CareerDiaryWorkplace[] {
    return this.payloadRows('career_diary_workplaces', candidateId)
      .map((row) => openPayload<CareerDiaryWorkplace>(
        this.sealedText,
        candidateId,
        'workplace',
        row.id,
        row.payload_cipher,
      ))
      .sort((left, right) => right.startDate.localeCompare(left.startDate));
  }

  listWorkplacesPage(
    candidateId: string,
    limit = 25,
    cursor?: string,
  ): CareerDiaryPage<CareerDiaryWorkplace> {
    const page = pagePayloadRows(
      this.database,
      'career_diary_workplaces',
      candidateId,
      limit,
      cursor,
      'created_at',
    );
    return {
      items: page.rows.map((row) => openPayload<CareerDiaryWorkplace>(
        this.sealedText,
        candidateId,
        'workplace',
        row.id,
        row.payload_cipher,
      )),
      nextCursor: page.nextCursor,
    };
  }

  updateWorkplace(
  candidateId: string,
  workplaceId: string,
  patch: CareerDiaryWorkplacePatch,
  now = new Date().toISOString(),
): CareerDiaryWorkplace | null {
  const workplace = this.getWorkplace(candidateId, workplaceId);
  if (!workplace) return null;
  const endDate = patch.endDate === undefined ? workplace.endDate : patch.endDate;
  const startDate = patch.startDate ?? workplace.startDate;
  if (endDate && endDate < startDate) return null;
  const updated = {
    ...workplace,
    ...patch,
    startDate,
    endDate,
    isPrimary: endDate ? false : workplace.isPrimary,
    status: endDate ? 'archived' as const : 'active' as const,
    updatedAt: now,
  };
  this.writeWorkplace(candidateId, updated);
  return updated;
}

  setPrimaryWorkplace(
    candidateId: string,
    workplaceId: string,
    now = new Date().toISOString(),
  ): CareerDiaryWorkplace | null {
    const selected = this.getWorkplace(candidateId, workplaceId);
    if (!selected || selected.status !== 'active') return null;
    this.inTransaction(() => {
      for (const workplace of this.listWorkplaces(candidateId)) {
        this.writeWorkplace(candidateId, {
          ...workplace,
          isPrimary: workplace.id === workplaceId,
          updatedAt: now,
        });
      }
    });
    return this.getWorkplace(candidateId, workplaceId);
  }

  getOverview(candidateId: string, asOf: string): CareerDiaryOverview {
  const goals: CareerDiaryGoalSummary[] = this.listGoals(candidateId).map((goal) => {
    const latestMeasurement = this.listMeasurements(candidateId, goal.id)[0] ?? null;
    return { ...goal, latestMeasurement, risk: evaluateCareerGoalRisk(goal, latestMeasurement, asOf) };
  });
  const weeklyReviews = this.listWeeklyReviews(candidateId);
  const weeklyReviewsTotal = Number(
    (this.database
      .prepare('SELECT COUNT(*) AS count FROM career_diary_weekly_reviews WHERE candidate_id = ?')
      .get(candidateId) as { count: number }).count,
  );
  const achievements = this.listAchievements(candidateId);
  const primaryWorkplace = this.listWorkplaces(candidateId)
    .find((workplace) => workplace.isPrimary && workplace.status === 'active') ?? null;
  return {
    asOf,
    primaryWorkplace,
    summary: {
      goalsAchieved: goals.filter((goal) => goal.risk.status === 'achieved').length,
      goalsAtRisk: goals.filter((goal) => goal.risk.status === 'at_risk').length,
      goalsTotal: goals.length,
      achievementsReadyToAdd: achievements.filter((item) => item.status === 'ready_to_add').length,
      weeklyReviewsTotal,
      weeklyReviewsInRow: weeklyReviewStreak(weeklyReviews),
    },
  };
}

  private payloadRows(table: 'career_diary_achievements' | 'career_diary_workplaces', candidateId: string): PayloadRow[] {
    return this.database
      .prepare('SELECT id, payload_cipher, created_at, updated_at FROM ' + table + ' WHERE candidate_id = ?')
      .all(candidateId) as unknown as PayloadRow[];
  }

  private insertGoal(candidateId: string, goal: CareerDiaryGoal): void {
    this.database
      .prepare(
        `INSERT INTO career_diary_goals
          (candidate_id, id, payload_cipher, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        candidateId,
        goal.id,
        sealPayload(this.sealedText, candidateId, 'goal', goal.id, goal),
        goal.createdAt,
        goal.updatedAt,
      );
  }

  private writeGoal(candidateId: string, goal: CareerDiaryGoal): void {
    this.database
      .prepare(
        `UPDATE career_diary_goals
         SET payload_cipher = ?, updated_at = ?
         WHERE candidate_id = ? AND id = ?`,
      )
      .run(
        sealPayload(this.sealedText, candidateId, 'goal', goal.id, goal),
        goal.updatedAt,
        candidateId,
        goal.id,
      );
  }

  getAchievement(candidateId: string, achievementId: string): CareerDiaryAchievement | null {
  const row = this.database
    .prepare(
      'SELECT id, payload_cipher FROM career_diary_achievements WHERE candidate_id = ? AND id = ?',
    )
    .get(candidateId, achievementId) as Pick<PayloadRow, 'id' | 'payload_cipher'> | undefined;
  return row
    ? openPayload<CareerDiaryAchievement>(
      this.sealedText,
      candidateId,
      'achievement',
      row.id,
      row.payload_cipher,
    )
    : null;
}

  private insertAchievement(candidateId: string, achievement: CareerDiaryAchievement): void {
    this.database
      .prepare(
        `INSERT INTO career_diary_achievements
          (candidate_id, id, payload_cipher, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        candidateId,
        achievement.id,
        sealPayload(this.sealedText, candidateId, 'achievement', achievement.id, achievement),
        achievement.createdAt,
        achievement.updatedAt,
      );
  }

  private writeAchievement(candidateId: string, achievement: CareerDiaryAchievement): void {
    this.database
      .prepare(
        `UPDATE career_diary_achievements
         SET payload_cipher = ?, updated_at = ?
         WHERE candidate_id = ? AND id = ?`,
      )
      .run(
        sealPayload(this.sealedText, candidateId, 'achievement', achievement.id, achievement),
        achievement.updatedAt,
        candidateId,
        achievement.id,
      );
  }

  getWorkplace(candidateId: string, workplaceId: string): CareerDiaryWorkplace | null {
  const row = this.database
    .prepare(
      'SELECT id, payload_cipher FROM career_diary_workplaces WHERE candidate_id = ? AND id = ?',
    )
    .get(candidateId, workplaceId) as Pick<PayloadRow, 'id' | 'payload_cipher'> | undefined;
  return row
    ? openPayload<CareerDiaryWorkplace>(
      this.sealedText,
      candidateId,
      'workplace',
      row.id,
      row.payload_cipher,
    )
    : null;
}

  private insertWorkplace(candidateId: string, workplace: CareerDiaryWorkplace): void {
    this.database
      .prepare(
        `INSERT INTO career_diary_workplaces
          (candidate_id, id, payload_cipher, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        candidateId,
        workplace.id,
        sealPayload(this.sealedText, candidateId, 'workplace', workplace.id, workplace),
        workplace.createdAt,
        workplace.updatedAt,
      );
  }

  private writeWorkplace(candidateId: string, workplace: CareerDiaryWorkplace): void {
    this.database
      .prepare(
        `UPDATE career_diary_workplaces
         SET payload_cipher = ?, updated_at = ?
         WHERE candidate_id = ? AND id = ?`,
      )
      .run(
        sealPayload(this.sealedText, candidateId, 'workplace', workplace.id, workplace),
        workplace.updatedAt,
        candidateId,
        workplace.id,
      );
  }
}
