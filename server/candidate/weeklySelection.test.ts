import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAutomationPausePort } from './automationPausePort';
import { changeCandidateStatus, previewCandidateStatus } from './candidateStatusService';
import { SqliteCandidateActionRepository } from './sqliteCandidateActionRepository';
import { SqliteCandidateAutomationRepository } from './sqliteCandidateAutomationRepository';
import { SqliteCandidateStatusRepository } from './sqliteCandidateStatusRepository';
import {
  runWeeklySelection,
  selectionWeek,
  type WeeklySelectionJobDeps,
} from './weeklySelectionJob';

const key = Buffer.alloc(32, 7);
const databases: DatabaseSync[] = [];
const now = new Date('2026-11-16T10:00:00.000Z');

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

function setup() {
  const database = new DatabaseSync(':memory:');
  database.exec(
    "CREATE TABLE candidates (id TEXT PRIMARY KEY) STRICT; INSERT INTO candidates VALUES ('alice'), ('bob');",
  );
  databases.push(database);
  const automation = new SqliteCandidateAutomationRepository(database, key);
  const actions = new SqliteCandidateActionRepository(database);
  const repository = new SqliteCandidateStatusRepository(database, key);
  const automationPause = createAutomationPausePort(automation, actions);
  const changeLog = { record: vi.fn(), markReverted: vi.fn() };
  return { repository, deps: { repository, automationPause, changeLog } };
}

const working = { status: 'working' as const, targetProfession: null };
const change = (options: Record<string, boolean>) => ({
  candidateId: 'alice',
  to: working,
  options,
  now,
  timezone: 'Europe/Moscow',
});

describe('B779: «Подборку в своей роли — раз в неделю»', () => {
  it('выключена, пока кандидат её не включил', () => {
    const { repository } = setup();
    expect(repository.weeklySelectionEnabled('alice')).toBe(false);
    expect(repository.weeklySelectionCandidates()).toEqual([]);
  });

  it('s02 предлагает её при смене статуса, отметка — как сейчас', () => {
    const { repository, deps } = setup();
    const option = () =>
      previewCandidateStatus(deps, 'alice', working, now).options.find(
        (entry) => entry.key === 'weeklySelection',
      );
    expect(option()).toEqual({
      key: 'weeklySelection',
      label: 'Подборку в своей роли — раз в неделю',
      checked: false,
    });
    repository.setWeeklySelection('alice', true, now);
    expect(option()?.checked).toBe(true);
  });

  it('смена статуса с отметкой включает, без отметки выключает, без поля не трогает', () => {
    const { repository, deps } = setup();
    changeCandidateStatus(deps, change({ weeklySelection: true }));
    expect(repository.weeklySelectionCandidates()).toEqual(['alice']);
    changeCandidateStatus(deps, {
      ...change({}),
      to: { status: 'looking', targetProfession: null },
    });
    expect(repository.weeklySelectionEnabled('alice')).toBe(true);
    changeCandidateStatus(deps, change({ weeklySelection: false }));
    expect(repository.weeklySelectionEnabled('alice')).toBe(false);
    expect(repository.weeklySelectionCandidates()).toEqual([]);
  });
});

describe('B779: неделя подборки', () => {
  it('начинается в понедельник в 09:00 по Москве', () => {
    expect(selectionWeek(new Date('2026-11-23T05:59:00.000Z'))).toBe('2026-W47');
    expect(selectionWeek(new Date('2026-11-23T06:00:00.000Z'))).toBe('2026-W48');
    expect(selectionWeek(new Date('2026-11-29T20:00:00.000Z'))).toBe('2026-W48');
    expect(selectionWeek(new Date('2027-01-04T06:00:00.000Z'))).toBe('2027-W01');
  });
});

describe('B779: еженедельная задача', () => {
  function jobDeps(fresh: Record<string, readonly string[] | Error>): WeeklySelectionJobDeps & {
    readonly recorded: { candidateId: string; idempotencyKey: string; sourceType: string }[];
    readonly errors: string[];
  } {
    const recorded: { candidateId: string; idempotencyKey: string; sourceType: string }[] = [];
    const errors: string[] = [];
    return {
      recorded,
      errors,
      candidates: () => Object.keys(fresh),
      freshVacancies: async (candidateId) => {
        const value = fresh[candidateId];
        if (value instanceof Error) throw value;
        return value;
      },
      record: (candidateId, input) => {
        expect(input.kind).toBe('new_vacancies_by_role');
        recorded.push({
          candidateId,
          idempotencyKey: input.idempotencyKey,
          sourceType: input.sourceType,
        });
      },
      logError: (candidateId) => errors.push(candidateId),
    };
  }

  it('одна подборка в неделю на кандидата, у кого есть новое в его ролях', async () => {
    const deps = jobDeps({ alice: ['c1', 'c2'], bob: [] });
    const result = await runWeeklySelection(deps, new Date('2026-11-23T07:00:00.000Z'));
    expect(deps.recorded).toEqual([
      {
        candidateId: 'alice',
        idempotencyKey: 'weekly-selection:2026-W48',
        sourceType: 'weekly_selection',
      },
    ]);
    expect(result).toEqual({ sent: 1, empty: 1, failed: 0 });
  });

  it('новое считается за прошедшую неделю', async () => {
    const since: string[] = [];
    const deps = {
      ...jobDeps({ alice: ['c1'] }),
      freshVacancies: async (_id: string, from: Date) => {
        since.push(from.toISOString());
        return ['c1'];
      },
    };
    await runWeeklySelection(deps, new Date('2026-11-23T07:00:00.000Z'));
    expect(since).toEqual(['2026-11-16T07:00:00.000Z']);
  });

  it('сбой у одного кандидата не останавливает остальных', async () => {
    const deps = jobDeps({ alice: new Error('engine down'), bob: ['c3'] });
    const result = await runWeeklySelection(deps, new Date('2026-11-23T07:00:00.000Z'));
    expect(deps.recorded.map((entry) => entry.candidateId)).toEqual(['bob']);
    expect(deps.errors).toEqual(['alice']);
    expect(result).toEqual({ sent: 1, empty: 0, failed: 1 });
  });
});
