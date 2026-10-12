import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { SqliteCandidateStore } from './sqliteCandidateStore';
import type { RoleSkillAssessmentRun } from '../domain/roleSkillAssessment';

const directories: string[] = [];
const encryptionKey = Buffer.alloc(32, 0x71);

function databasePath(): string {
  const directory = mkdtempSync(join(tmpdir(), 'openqareer-b461-'));
  directories.push(directory);
  return join(directory, 'candidate.sqlite');
}

function run(id: string): RoleSkillAssessmentRun {
  const now = '2026-10-10T12:00:00.000Z';
  return {
    id,
    revision: 1,
    roleTitle: 'Руководитель продукта',
    roleVersion: 2,
    status: 'dialogue',
    consentedAt: now,
    startedAt: now,
    updatedAt: now,
    completedAt: null,
    sampleSize: 8,
    evidenceObservedAt: now,
    dialogueQuestions: ['Вопрос 1', 'Вопрос 2', 'Вопрос 3'],
    dialogueEntries: [],
    currentDialogueIndex: 0,
    suggestions: [],
    cases: [],
    skills: Array.from({ length: 5 }, (_, index) => ({
      id: `skill-${index}`,
      name: `Навык ${index}`,
      isKeySkill: index < 2,
      grade: 'not_confirmed',
      explanation: 'Навык ещё не проверен.',
      caseId: null,
      sourceRefs: [],
    })),
    currentCaseIndex: 0,
    readiness: { ready: false, confirmedCount: 0, missingKeySkillIds: ['skill-0', 'skill-1'] },
    modelError: null,
    lastRequest: null,
  };
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('SQLite role skill assessment repository', () => {
  it('stores encrypted, candidate-scoped runs and exports them for the owning candidate', () => {
    const path = databasePath();
    const store = new SqliteCandidateStore({ databasePath: path, encryptionKey });
    const candidate = store.createCandidate({ dataClass: 'synthetic', locale: 'ru-RU' });
    const other = store.createCandidate({ dataClass: 'synthetic', locale: 'ru-RU' });
    const candidateRun = run(crypto.randomUUID());
    const secretAnswer = 'В служебном контуре хранится только зашифрованный ответ кандидата.';
    const answeredRun = {
      ...candidateRun,
      status: 'cases' as const,
      dialogueEntries: [
        { id: crypto.randomUUID(), question: 'Вопрос 1', answer: secretAnswer, answeredAt: candidateRun.startedAt },
      ],
    };

    store.roleSkillAssessments.create(candidate.id, answeredRun);
    expect(store.roleSkillAssessments.get(candidate.id, candidateRun.id)).toEqual(answeredRun);
    expect(store.roleSkillAssessments.get(other.id, candidateRun.id)).toBeNull();
    expect(store.exportCandidate(candidate.id).roleSkillAssessments).toEqual([answeredRun]);
    store.close();

    const raw = new DatabaseSync(path, { enableForeignKeyConstraints: true });
    const stored = raw
      .prepare('SELECT run_cipher FROM role_skill_assessment_runs WHERE candidate_id = ?')
      .get(candidate.id) as { run_cipher: string };
    expect(stored.run_cipher).not.toContain(secretAnswer);
    raw.close();
  });

  it('persists revisions across restart and rejects stale updates', () => {
    const path = databasePath();
    const firstStore = new SqliteCandidateStore({ databasePath: path, encryptionKey });
    const candidate = firstStore.createCandidate({ dataClass: 'synthetic', locale: 'ru-RU' });
    const initial = run(crypto.randomUUID());
    firstStore.roleSkillAssessments.create(candidate.id, initial);
    const updated = { ...initial, revision: 2, status: 'suggestions' as const, currentDialogueIndex: 3 };

    expect(firstStore.roleSkillAssessments.update(candidate.id, updated, 1)).toBe(true);
    expect(firstStore.roleSkillAssessments.update(candidate.id, updated, 1)).toBe(false);
    firstStore.close();

    const reopened = new SqliteCandidateStore({ databasePath: path, encryptionKey });
    expect(reopened.roleSkillAssessments.get(candidate.id, initial.id)).toEqual(updated);
    expect(reopened.deleteCandidate(candidate.id)).toBe(true);
    expect(reopened.roleSkillAssessments.list(candidate.id)).toEqual([]);
    reopened.close();
  });
});
