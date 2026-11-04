import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SealedText } from '../sealedText';
import {
  createCandidate,
  createStore,
  directories,
  output,
  turnRequest,
} from '../sqliteTestHarness';
import { turnAssociatedData } from './shared';
import { parseStoredTurnResult } from './storedTurnRead';

const TURN_KEY = '51df5f57-df61-4ac2-98af-202607310101';

const validProposal = {
  kind: 'vacancies.search',
  objective: 'Найти вакансии',
  evidenceRefs: ['fact-1'],
  acceptanceCriteria: ['Список собран'],
  expectedSignal: 'Больше ответов',
  measureAfter: '2026-12-01',
  risk: 'read_only',
};
// 05.09 shape: resume.revise from before the concrete profile target became mandatory.
const legacyProposal = { ...validProposal, kind: 'resume.revise', objective: 'Старое предложение' };

const storedResult = (actionProposals: unknown[]) => ({ ...output.result, actionProposals });

function storeWithStoredResult(result: unknown) {
  const directory = mkdtempSync(join(tmpdir(), 'openqareer-stored-turn-'));
  directories.push(directory);
  const databasePath = join(directory, 'store.db');
  const store = createStore(databasePath);
  const candidate = createCandidate(store);
  store.startTurn(candidate.id, TURN_KEY, turnRequest);
  store.completeTurn(candidate.id, TURN_KEY, output);
  const sealed = new SealedText(Buffer.alloc(32, 4)).seal(
    typeof result === 'string' ? result : JSON.stringify(result),
    turnAssociatedData(candidate.id, TURN_KEY),
  );
  const raw = new DatabaseSync(databasePath);
  raw.prepare('UPDATE turns SET result_cipher = ? WHERE idempotency_key = ?').run(sealed, TURN_KEY);
  raw.close();
  return { store, candidateId: candidate.id };
}

afterEach(() => vi.restoreAllMocks());

describe('parseStoredTurnResult (04.11)', () => {
  it('drops only the proposal the current schema no longer accepts', () => {
    const parsed = parseStoredTurnResult(storedResult([legacyProposal, validProposal]));
    expect(parsed.message).toBe(output.result.message);
    expect(parsed.actionProposals.map((proposal) => proposal.objective)).toEqual([
      'Найти вакансии',
    ]);
  });

  it('still refuses a stored turn broken outside the proposals', () => {
    expect(() => parseStoredTurnResult({ ...storedResult([]), phase: 'unknown' })).toThrow();
  });
});

describe('a stored turn the schema refuses', () => {
  it('keeps the whole snapshot readable and the turn without the old proposal', () => {
    const { store, candidateId } = storeWithStoredResult(storedResult([legacyProposal]));
    const snapshot = store.getSnapshot(candidateId);
    expect(snapshot.messages).toHaveLength(2);
    expect(snapshot.turns[0]?.result?.message).toBe(output.result.message);
    expect(snapshot.turns[0]?.result?.actionProposals).toEqual([]);
  });

  it('shows an unreadable turn without a result, logs it, and reads the rest', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { store, candidateId } = storeWithStoredResult({ ...storedResult([]), phase: 'unknown' });
    const snapshot = store.getSnapshot(candidateId);
    expect(snapshot.messages).toHaveLength(2);
    expect(snapshot.turns[0]).toMatchObject({ status: 'completed', result: null, provenance: null });
    expect(store.getCoachTurn(candidateId, TURN_KEY)).toEqual({ status: 'completed', result: null });
    const logged = warn.mock.calls.map((call) => String(call[0])).join('\n');
    expect(logged).toContain('stored-turn-unreadable');
    expect(logged).not.toContain(output.result.message);
  });

  it('survives a stored turn that is not JSON', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { store, candidateId } = storeWithStoredResult('not json');
    expect(store.getSnapshot(candidateId).turns[0]?.result).toBeNull();
  });
});
