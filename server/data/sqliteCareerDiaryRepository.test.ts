import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { SealedText } from './sealedText';
import { MIGRATION_44 } from './careerDiarySchema';
import { InvalidCareerDiaryCursorError, SqliteCareerDiaryRepository } from './sqliteCareerDiaryRepository';

function createDiaryStore() {
  const database = new DatabaseSync(':memory:', { enableForeignKeyConstraints: true });
  database.exec('CREATE TABLE candidates (id TEXT PRIMARY KEY) STRICT;');
  database.exec("INSERT INTO candidates (id) VALUES ('candidate-a'), ('candidate-b');");
  const repository = new SqliteCareerDiaryRepository(database, new SealedText(Buffer.alloc(32, 17)));
  return { database, repository };
}

const goalInput = {
  title: 'Снизить число инцидентов P1',
  type: 'operational' as const,
  horizon: 'quarter' as const,
  startDate: '2026-12-01',
  dueDate: '2026-12-31',
  unit: 'инцидентов в месяц',
  baselineValue: 9,
  targetValue: 4,
};

describe('career diary storage', () => {
  it('applies the additive schema repeatedly without altering existing tables', () => {
    const database = new DatabaseSync(':memory:', { enableForeignKeyConstraints: true });
    database.exec('CREATE TABLE candidates (id TEXT PRIMARY KEY) STRICT;');

    expect(() => database.exec(MIGRATION_44)).not.toThrow();
    expect(() => database.exec(MIGRATION_44)).not.toThrow();
    const tables = database.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'career_diary_%'",
    ).all() as Array<{ name: string }>;

    expect(tables.map(({ name }) => name).sort()).toEqual([
      'career_diary_achievements',
      'career_diary_goals',
      'career_diary_measurements',
      'career_diary_weekly_reviews',
      'career_diary_workplaces',
    ]);
    database.close();
  });

  it('seals goal fields and keeps goal ownership candidate-scoped', () => {
    const { database, repository } = createDiaryStore();
    const goal = repository.createGoal('candidate-a', goalInput, '2026-12-01T10:00:00.000Z');
    const row = database.prepare(
      'SELECT payload_cipher FROM career_diary_goals WHERE candidate_id = ? AND id = ?',
    ).get('candidate-a', goal.id) as { payload_cipher: string };

    expect(row.payload_cipher).not.toContain(goalInput.title);
    expect(repository.getGoal('candidate-a', goal.id)).toEqual(goal);
    expect(repository.getGoal('candidate-b', goal.id)).toBeNull();
    database.close();
  });

  it('keeps measurement history ordered and removes it with its goal or candidate', () => {
    const { database, repository } = createDiaryStore();
    const goal = repository.createGoal('candidate-a', goalInput, '2026-12-01T10:00:00.000Z');
    const child = repository.createGoal('candidate-a', {
      ...goalInput,
      title: 'Проверить причины инцидентов',
      parentGoalId: goal.id,
    }, '2026-12-01T10:00:00.000Z');
    repository.recordMeasurement('candidate-a', child.id, {
      value: 2,
      measuredAt: '2026-12-15',
      note: null,
    }, '2026-12-15T10:00:00.000Z');
    repository.recordMeasurement('candidate-a', goal.id, {
      value: 8,
      measuredAt: '2026-12-15',
      note: 'Введено кандидатом.',
    }, '2026-12-15T10:00:00.000Z');
    repository.recordMeasurement('candidate-a', goal.id, {
      value: 6,
      measuredAt: '2026-12-20',
      note: null,
    }, '2026-12-20T10:00:00.000Z');

    expect(repository.listMeasurements('candidate-a', goal.id).map(({ value }) => value)).toEqual([6, 8]);
    expect(repository.listMeasurements('candidate-b', goal.id)).toEqual([]);
    repository.deleteGoal('candidate-a', goal.id);
    expect(repository.listMeasurements('candidate-a', goal.id)).toEqual([]);
    expect(repository.getGoal('candidate-a', child.id)?.parentGoalId).toBeNull();
    expect(repository.listMeasurements('candidate-a', child.id)).toHaveLength(1);

    const secondGoal = repository.createGoal('candidate-a', goalInput, '2026-12-21T10:00:00.000Z');
    repository.recordMeasurement('candidate-a', secondGoal.id, {
      value: 5,
      measuredAt: '2026-12-21',
      note: null,
    }, '2026-12-21T10:00:00.000Z');
    database.prepare('DELETE FROM candidates WHERE id = ?').run('candidate-a');
    expect(database.prepare('SELECT COUNT(*) AS count FROM career_diary_goals').get()).toMatchObject({ count: 0 });
    expect(database.prepare('SELECT COUNT(*) AS count FROM career_diary_measurements').get()).toMatchObject({ count: 0 });
    database.close();
  });

  it('upserts one weekly review per candidate and seals its narrative', () => {
    const { database, repository } = createDiaryStore();
    const first = repository.upsertWeeklyReview('candidate-a', {
      weekStart: '2026-12-07',
      movedForward: 'Закрыли планирование.',
      blockers: 'Ждём данные.',
      learning: 'Раньше уточнять владельцев.',
      risks: 'Срок согласования бюджета.',
      nextWeek: 'Назначить встречу.',
    }, '2026-12-14T10:00:00.000Z');
    const second = repository.upsertWeeklyReview('candidate-a', {
      weekStart: '2026-12-07',
      movedForward: 'Согласовали бюджет.',
      blockers: 'Нет.',
      learning: 'Проверять вводные заранее.',
      risks: 'Нет.',
      nextWeek: 'Начать пилот.',
    }, '2026-12-15T10:00:00.000Z');
    const row = database.prepare(
      'SELECT payload_cipher FROM career_diary_weekly_reviews WHERE candidate_id = ? AND week_start = ?',
    ).get('candidate-a', '2026-12-07') as { payload_cipher: string };

    expect(second.createdAt).toBe(first.createdAt);
    expect(second.updatedAt).not.toBe(first.updatedAt);
    expect(repository.listWeeklyReviews('candidate-a')).toHaveLength(1);
    expect(repository.getWeeklyReview('candidate-b', '2026-12-07')).toBeNull();
    expect(row.payload_cipher).not.toContain('Согласовали бюджет.');
    database.close();
  });

  it('maintains one primary workplace and creates achievements ready to add', () => {
    const { database, repository } = createDiaryStore();
    const first = repository.createWorkplace('candidate-a', {
      company: 'Норма Групп',
      title: 'Head of Engineering',
      startDate: '2026-11-03',
      endDate: null,
    }, '2026-12-01T10:00:00.000Z');
    const second = repository.createWorkplace('candidate-a', {
      company: 'Финтех Лаб',
      title: 'Руководитель разработки',
      startDate: '2020-01-01',
      endDate: null,
    }, '2026-12-01T10:00:00.000Z');
    repository.setPrimaryWorkplace('candidate-a', first.id, '2026-12-02T10:00:00.000Z');
    repository.setPrimaryWorkplace('candidate-a', second.id, '2026-12-03T10:00:00.000Z');
    const achievement = repository.createAchievement('candidate-a', {
      situation: 'Долгий релизный цикл.',
      action: 'Согласовал план изменений.',
      result: 'Цикл сократился.',
    }, '2026-12-03T10:00:00.000Z');

    expect(repository.listWorkplaces('candidate-a').filter(({ isPrimary }) => isPrimary)).toMatchObject([
      { id: second.id, isPrimary: true },
    ]);
    expect(repository.listWorkplaces('candidate-b')).toEqual([]);
    expect(achievement.status).toBe('ready_to_add');
    expect(repository.listAchievements('candidate-a')).toEqual([achievement]);
    database.close();
  });
  it('paginates encrypted goal and measurement lists with stable opaque cursors', () => {
    const { database, repository } = createDiaryStore();
    for (const title of ['Цель 1', 'Цель 2', 'Цель 3']) {
      repository.createGoal('candidate-a', { ...goalInput, title }, '2026-12-01T10:00:00.000Z');
    }
    const firstGoals = repository.listGoalsPage('candidate-a', 2);
    const lastGoals = repository.listGoalsPage('candidate-a', 2, firstGoals.nextCursor ?? undefined);
    expect(firstGoals.items).toHaveLength(2);
    expect(lastGoals.items).toHaveLength(1);
    expect(new Set([...firstGoals.items, ...lastGoals.items].map(({ id }) => id)).size).toBe(3);
    expect(() => repository.listGoalsPage('candidate-a', 2, 'invalid')).toThrow(
      InvalidCareerDiaryCursorError,
    );

    const goal = firstGoals.items[0]!;
    for (const value of [1, 2, 3]) {
      repository.recordMeasurement('candidate-a', goal.id, {
        value,
        measuredAt: '2026-12-0' + (value + 1),
      }, '2026-12-0' + (value + 1) + 'T10:00:00.000Z');
    }
    const firstMeasurements = repository.listMeasurementsPage('candidate-a', goal.id, 2);
    const lastMeasurements = repository.listMeasurementsPage(
      'candidate-a',
      goal.id,
      2,
      firstMeasurements.nextCursor ?? undefined,
    );
    expect(firstMeasurements.items.map(({ value }) => value)).toEqual([3, 2]);
    expect(lastMeasurements.items.map(({ value }) => value)).toEqual([1]);
    database.close();
  });
});