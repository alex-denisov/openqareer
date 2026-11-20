import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AutomationPausePort } from './automationPausePort';
import { createAutomationPausePort } from './automationPausePort';
import {
  changeCandidateStatus,
  readCandidateStatus,
  revertCandidateStatus,
} from './candidateStatusService';
import { SqliteCandidateActionRepository } from './sqliteCandidateActionRepository';
import { SqliteCandidateAutomationRepository } from './sqliteCandidateAutomationRepository';
import { SqliteCandidateStatusRepository } from './sqliteCandidateStatusRepository';

const key = Buffer.alloc(32, 7);
const databases: DatabaseSync[] = [];
const now = new Date('2026-11-16T10:00:00.000Z');

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

function setup() {
  const database = new DatabaseSync(':memory:');
  database.exec("CREATE TABLE candidates (id TEXT PRIMARY KEY) STRICT; INSERT INTO candidates VALUES ('alice');");
  databases.push(database);
  const automation = new SqliteCandidateAutomationRepository(database, key);
  const actions = new SqliteCandidateActionRepository(database);
  return {
    automation,
    actions,
    repository: new SqliteCandidateStatusRepository(database, key),
    automationPause: createAutomationPausePort(automation, actions),
  };
}

const input = { candidateId: 'alice', to: { status: 'working' as const, targetProfession: null }, options: {}, now, timezone: 'Europe/Moscow' };

describe('changeCandidateStatus', () => {
  it('undoes the status and the pause when the change history cannot be written', () => {
    const { automation, actions, repository, automationPause } = setup();
    const changeLog = { record: vi.fn(() => { throw new Error('disk full'); }), markReverted: vi.fn() };
    expect(() => changeCandidateStatus({ repository, automationPause, changeLog }, input)).toThrow('disk full');
    expect(readCandidateStatus({ repository }, 'alice', now).current.chosen).toBe(false);
    expect(automation.getSettings('alice').pausedUntil ?? null).toBeNull();
    expect(actions.isKillSwitchActive(undefined, 'alice')).toBe(false);
  });

  it('does not touch a pause the candidate already had', () => {
    const { automation, repository, automationPause } = setup();
    const earlier = '2026-12-01T00:00:00.000Z';
    automation.setPause('alice', earlier);
    const spy: AutomationPausePort = { ...automationPause, pause: vi.fn(automationPause.pause) };
    const changeLog = { record: vi.fn(), markReverted: vi.fn() };
    const result = changeCandidateStatus({ repository, automationPause: spy, changeLog } as never, input);
    expect(result.applied).toEqual({ pauseAutoApply: false });
    expect(spy.pause).not.toHaveBeenCalled();
    expect(automation.getSettings('alice').pausedUntil).toBe(earlier);
  });
});

describe('revertCandidateStatus (B665)', () => {
  it('«Вернуть прежний» — второй шаг в «Истории изменений», первый остаётся', () => {
    const { repository, automationPause } = setup();
    const changeLog = { record: vi.fn(), markReverted: vi.fn() };
    const deps = { repository, automationPause, changeLog };
    const from = { ...input, to: { status: 'job_search' as const, targetProfession: null } };
    changeCandidateStatus(deps, from);
    changeCandidateStatus(deps, { ...input, now: new Date(now.getTime() + 60_000) });
    const later = new Date(now.getTime() + 120_000);
    const state = revertCandidateStatus(deps, 'alice', later);
    expect(state.current.status).toBe('job_search');
    expect(changeLog.markReverted).not.toHaveBeenCalled();
    const steps = changeLog.record.mock.calls.map(([entry]) => [entry.previous, entry.applied, entry.label]);
    expect(steps.slice(1)).toEqual([
      ['Ищу работу', 'Работаю', steps[1][2]],
      ['Работаю', 'Ищу работу', 'Возврат прежнего статуса'],
    ]);
    expect(changeLog.record.mock.calls[2][0]).toMatchObject({
      actor: 'candidate',
      createdAt: later.toISOString(),
    });
  });
});

describe('createAutomationPausePort', () => {
  it('pauses like the manual route and restores the earlier runtime', () => {
    const { automation, actions, automationPause } = setup();
    const before = automation.schedulerRepository.getRuntime('alice');
    const snapshot = automationPause.pause('alice', now);
    expect(automationPause.isPaused('alice', now)).toBe(true);
    expect(actions.isKillSwitchActive(undefined, 'alice')).toBe(true);
    expect(automation.schedulerRepository.getRuntime('alice').status).toBe('paused');
    expect(automationPause.restore('alice', snapshot)).toBe(true);
    expect(automationPause.isPaused('alice', now)).toBe(false);
    expect(actions.isKillSwitchActive(undefined, 'alice')).toBe(false);
    expect(automation.schedulerRepository.getRuntime('alice')).toMatchObject({
      status: before.status, pauseUntil: before.pauseUntil, nextSendAt: before.nextSendAt,
    });
  });

  it('leaves a kill switch that stood before the status change', () => {
    const { actions, automationPause } = setup();
    actions.setKillSwitch('candidate:alice', true, 'manual_pause');
    const snapshot = automationPause.pause('alice', now);
    expect(snapshot.killSwitchSetAt).toBeNull();
    expect(automationPause.restore('alice', snapshot)).toBe(true);
    expect(actions.getKillSwitch('candidate:alice')?.active).toBe(true);
  });

  it('leaves an emergency pause switched on before the status change', () => {
    const { automation, actions, automationPause } = setup();
    automation.schedulerRepository.setEmergencyPause('alice', true);
    actions.setKillSwitch('candidate:alice', true, 'manual_pause');
    const snapshot = automationPause.pause('alice', now);
    expect(snapshot.runtimeTouched).toBe(false);
    automationPause.restore('alice', snapshot);
    expect(automation.schedulerRepository.getRuntime('alice')).toMatchObject({ emergencyPaused: true, status: 'paused' });
    expect(actions.getKillSwitch('candidate:alice')?.active).toBe(true);
  });

  it('leaves an emergency pause switched on after the status change', async () => {
    const { automation, actions, automationPause } = setup();
    const snapshot = automationPause.pause('alice', now);
    await new Promise((resolve) => setTimeout(resolve, 5));
    automation.schedulerRepository.setEmergencyPause('alice', true);
    actions.setKillSwitch('candidate:alice', true, 'manual_pause');
    automationPause.restore('alice', snapshot);
    expect(automation.schedulerRepository.getRuntime('alice').emergencyPaused).toBe(true);
    expect(actions.getKillSwitch('candidate:alice')?.active).toBe(true);
    expect(automationPause.isPaused('alice', now)).toBe(false);
  });
});
