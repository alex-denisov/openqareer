import { describe, expect, it } from 'vitest';
import { createCandidate, createStore } from './sqliteTestHarness';
import {
  createInterviewSession,
  transitionInterviewSession,
} from '../domain/interviewSimulator';

function session(id: string) {
  return createInterviewSession({
    id,
    mode: 'text',
    roleTitle: 'Руководитель инженерной команды',
    applicationId: null,
    questionTypes: ['behavioral'],
    stressMode: false,
    stories: [],
    questionIds: ['q1', 'q2', 'q3', 'q4', 'q5'],
    now: '2026-10-11T08:00:00.000Z',
  });
}

describe('SQLite interview simulator repository', () => {
  it('stores the current candidate session with optimistic versions', () => {
    const store = createStore();
    const owner = createCandidate(store);
    const started = session('interview-1');

    expect(store.interviewSimulatorRepo.create(owner.id, started, started.startedAt)).toEqual(started);
    expect(store.interviewSimulatorRepo.getCurrent(owner.id)).toEqual(started);

    const paused = transitionInterviewSession(started, 'pause', '2026-10-11T08:01:00.000Z');
    expect(
      store.interviewSimulatorRepo.update(owner.id, started.id, started.version, paused, paused.updatedAt),
    ).toEqual(paused);
    expect(
      store.interviewSimulatorRepo.update(owner.id, started.id, started.version, paused, paused.updatedAt),
    ).toBeNull();
    expect(store.exportCandidate(owner.id).interviewSession).toEqual(paused);
  });

  it('deletes the current session with its candidate account', () => {
    const store = createStore();
    const owner = createCandidate(store);
    const started = session('interview-delete');
    store.interviewSimulatorRepo.create(owner.id, started, started.startedAt);

    expect(store.deleteCandidate(owner.id)).toBe(true);
    expect(store.interviewSimulatorRepo.getCurrent(owner.id)).toBeNull();
  });
});
