import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import type { CandidateStatusId } from '../../shared/candidateStatus';
import type { SignalApplication } from '../domain/statusSignals';
import { SqliteStatusSignalRepository } from './sqliteStatusSignalRepository';
import {
  answerStatusSignal,
  readStatusSignal,
  SignalNotActiveError,
  SignalUndoUnavailableError,
  undoStatusSignalAnswer,
  type StatusSignalDeps,
} from './statusSignalService';

const databases: DatabaseSync[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

const TZ = 'Europe/Moscow';
const at = (iso: string) => new Date(iso);
const NOW = at('2026-11-16T12:00:00.000Z');

function applied(id: string, appliedAt: string): SignalApplication {
  return {
    id,
    vacancyKey: id,
    functionCode: 'engineering',
    stage: 'applied',
    createdAt: appliedAt,
    appliedAt,
    stageChangedAt: appliedAt,
    automatic: false,
  };
}

function setup(status: CandidateStatusId = 'looking') {
  const database = new DatabaseSync(':memory:');
  database.exec(
    "CREATE TABLE candidates (id TEXT PRIMARY KEY) STRICT; INSERT INTO candidates VALUES ('alice');",
  );
  databases.push(database);
  const state = {
    status,
    applications: [
      applied('a1', '2026-11-15T10:00:00.000Z'),
      applied('a2', '2026-11-14T10:00:00.000Z'),
    ],
  };
  const deps: StatusSignalDeps = {
    answers: new SqliteStatusSignalRepository(database),
    currentStatus: () => ({ status: state.status, since: null }),
    sources: {
      applications: () => state.applications,
      roleFamilySkips: () => [],
      targetFunctions: () => ['engineering'],
      functionLabels: { engineering: 'Разработка' },
    },
  };
  return { deps, state };
}

describe('сервис сигналов «Сегодня»', () => {
  it('отдаёт сигнал с фактами; ответа ещё нет', () => {
    const { deps } = setup();
    const state = readStatusSignal(deps, 'alice', NOW, TZ);
    expect(state.signal?.kind).toBe('started_search');
    expect(state.signal?.facts.length).toBeGreaterThan(0);
    expect(state.answered).toBeNull();
  });

  it('«Нет» прячет сигнал и до конца дня даёт отменить ответ', () => {
    const { deps } = setup();
    const state = answerStatusSignal(deps, {
      candidateId: 'alice',
      kind: 'started_search',
      answer: 'no',
      now: NOW,
      timezone: TZ,
    });
    expect(state.signal).toBeNull();
    expect(state.answered).toMatchObject({
      kind: 'started_search',
      answer: 'no',
      undoUntil: '2026-11-16T21:00:00.000Z',
    });
    const nextDay = readStatusSignal(deps, 'alice', at('2026-11-16T21:00:01.000Z'), TZ);
    expect(nextDay).toEqual({ signal: null, answered: null });
  });

  it('отмена ответа возвращает сигнал; второй раз отменять нечего', () => {
    const { deps } = setup();
    answerStatusSignal(deps, {
      candidateId: 'alice',
      kind: 'started_search',
      answer: 'no',
      now: NOW,
      timezone: TZ,
    });
    const state = undoStatusSignalAnswer(deps, 'alice', at('2026-11-16T12:05:00.000Z'), TZ);
    expect(state.signal?.kind).toBe('started_search');
    expect(state.answered).toBeNull();
    expect(() => undoStatusSignalAnswer(deps, 'alice', at('2026-11-16T12:06:00.000Z'), TZ)).toThrow(
      SignalUndoUnavailableError,
    );
  });

  it('отменяется только самый новый ответ: вторая отмена не трогает прежний', () => {
    const { deps } = setup();
    const ask = (answer: 'later' | 'no', time: string) =>
      answerStatusSignal(deps, {
        candidateId: 'alice',
        kind: 'started_search',
        answer,
        now: at(time),
        timezone: TZ,
      });
    ask('no', '2026-11-16T09:00:00.000Z');
    undoStatusSignalAnswer(deps, 'alice', at('2026-11-16T09:01:00.000Z'), TZ);
    ask('later', '2026-11-16T09:02:00.000Z');
    undoStatusSignalAnswer(deps, 'alice', at('2026-11-16T09:03:00.000Z'), TZ);
    ask('no', '2026-11-16T09:04:00.000Z');
    undoStatusSignalAnswer(deps, 'alice', at('2026-11-16T09:05:00.000Z'), TZ);
    expect(() => undoStatusSignalAnswer(deps, 'alice', at('2026-11-16T09:06:00.000Z'), TZ)).toThrow(
      SignalUndoUnavailableError,
    );
    expect(deps.answers.active('alice')).toEqual([]);
  });

  it('после отмены нового ответа прежний ответ того же дня остаётся в силе', () => {
    const { deps } = setup();
    const stored = (
      id: string,
      kind: 'started_search' | 'changing_profession',
      createdAt: string,
    ) =>
      deps.answers.record({
        id,
        candidateId: 'alice',
        kind,
        answer: 'no',
        createdAt,
        undoUntil: '2026-11-16T21:00:00.000Z',
      });
    stored('first', 'changing_profession', '2026-11-16T09:00:00.000Z');
    stored('second', 'started_search', '2026-11-16T10:00:00.000Z');
    undoStatusSignalAnswer(deps, 'alice', at('2026-11-16T10:01:00.000Z'), TZ);
    expect(() => undoStatusSignalAnswer(deps, 'alice', at('2026-11-16T10:02:00.000Z'), TZ)).toThrow(
      SignalUndoUnavailableError,
    );
    expect(deps.answers.active('alice').map((item) => item.id)).toEqual(['first']);
  });

  it('на следующий день ответ отменить нельзя', () => {
    const { deps } = setup();
    answerStatusSignal(deps, {
      candidateId: 'alice',
      kind: 'started_search',
      answer: 'no',
      now: NOW,
      timezone: TZ,
    });
    expect(() => undoStatusSignalAnswer(deps, 'alice', at('2026-11-17T08:00:00.000Z'), TZ)).toThrow(
      SignalUndoUnavailableError,
    );
  });

  it('второе «Нет» через месяц выключает сигнал насовсем', () => {
    const { deps, state } = setup();
    answerStatusSignal(deps, {
      candidateId: 'alice',
      kind: 'started_search',
      answer: 'no',
      now: NOW,
      timezone: TZ,
    });
    const later = at('2026-12-20T12:00:00.000Z');
    state.applications = [
      applied('b1', '2026-12-19T10:00:00.000Z'),
      applied('b2', '2026-12-18T10:00:00.000Z'),
    ];
    expect(readStatusSignal(deps, 'alice', later, TZ).signal?.kind).toBe('started_search');
    answerStatusSignal(deps, {
      candidateId: 'alice',
      kind: 'started_search',
      answer: 'no',
      now: later,
      timezone: TZ,
    });
    const year = at('2027-12-20T12:00:00.000Z');
    state.applications = [
      applied('c1', '2027-12-19T10:00:00.000Z'),
      applied('c2', '2027-12-18T10:00:00.000Z'),
    ];
    expect(readStatusSignal(deps, 'alice', year, TZ).signal).toBeNull();
  });

  it('ответить можно только на сигнал, который сейчас показан', () => {
    const { deps } = setup('working');
    expect(() =>
      answerStatusSignal(deps, {
        candidateId: 'alice',
        kind: 'started_search',
        answer: 'yes',
        now: NOW,
        timezone: TZ,
      }),
    ).toThrow(SignalNotActiveError);
    expect(deps.answers.active('alice')).toEqual([]);
  });

  it('«Верно» статус не меняет: кандидат меняет его сам', () => {
    const { deps, state } = setup();
    const result = answerStatusSignal(deps, {
      candidateId: 'alice',
      kind: 'started_search',
      answer: 'yes',
      now: NOW,
      timezone: TZ,
    });
    expect(state.status).toBe('looking');
    expect(result.signal).toBeNull();
  });
});
