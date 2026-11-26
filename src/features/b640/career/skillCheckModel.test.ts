import { describe, expect, it } from 'vitest';
import type { RoleSkillAssessmentRun } from '../../../../server/domain/roleSkillAssessment';
import {
  caseEyebrow,
  dialogueEyebrow,
  gradeTag,
  profileLine,
  resultTitle,
  runSkillRows,
  skillCheckPath,
} from './skillCheckModel';

type RunCase = RoleSkillAssessmentRun['cases'][number];

const evaluation = (grades: readonly ('confirmed' | 'partial' | 'not_confirmed')[]) => ({
  candidateAnswer: 'ответ',
  grade: grades[0] ?? 'confirmed',
  criteria: grades.map((grade, index) => ({
    criterionId: `c${index}`,
    grade,
    explanation: `пункт ${index}`,
    candidateExcerpt: `цитата ${index}`,
    sourceRefIds: [],
  })),
});

const runCase = (skillName: string, status: RunCase['status'] = 'pending'): RunCase =>
  ({
    assessmentCase: {
      id: `case-${skillName}`,
      skillId: `s-${skillName}`,
      skillName,
      prompt: 'Что вы сделаете?',
    },
    status,
    answer: null,
    evaluation: null,
  }) as unknown as RunCase;

const run = (patch: Partial<RoleSkillAssessmentRun> = {}): RoleSkillAssessmentRun =>
  ({
    roleTitle: 'Руководитель разработки',
    dialogueQuestions: ['a', 'b', 'c'],
    currentDialogueIndex: 1,
    cases: [runCase('Go'), runCase('Сроки')],
    currentCaseIndex: 1,
    skills: [
      { id: 's-Go', name: 'Go', grade: 'confirmed', caseId: 'case-Go' },
      { id: 's-Сроки', name: 'Сроки', grade: 'not_confirmed', caseId: 'case-Сроки' },
      { id: 's-K8s', name: 'Kubernetes', grade: 'not_confirmed', caseId: null },
    ],
    status: 'cases',
    ...patch,
  }) as unknown as RoleSkillAssessmentRun;

describe('skillCheckModel', () => {
  it('numbers dialogue and cases as one row of questions', () => {
    expect(dialogueEyebrow(run())).toBe('О вашем опыте · вопрос 2 из 5');
    const current = run();
    expect(caseEyebrow(current, current.cases[1]!)).toBe('Сроки · вопрос 5 из 5');
  });

  it('titles the case result by criteria disclosed', () => {
    expect(resultTitle(evaluation(['confirmed', 'confirmed', 'confirmed']))).toBe(
      'Раскрыты все 3 пункта',
    );
    expect(resultTitle(evaluation(['confirmed', 'partial', 'not_confirmed']))).toBe(
      'Раскрыт 1 пункт из 3',
    );
    expect(resultTitle(evaluation(['not_confirmed', 'not_confirmed']))).toBe('Пункты не раскрыты');
    expect(resultTitle(evaluation(Array(5).fill('confirmed')))).toBe('Раскрыты все 5 пунктов');
  });

  it('tags each grade', () => {
    expect(gradeTag('confirmed')).toEqual({ tone: 'ok', text: 'раскрыто' });
    expect(gradeTag('partial')).toEqual({ tone: 'part', text: 'частично' });
    expect(gradeTag('not_confirmed')).toEqual({ tone: 'miss', text: 'не раскрыто' });
  });

  it('says what goes into the profile', () => {
    expect(profileLine('Сроки', 'confirmed')).toBe(
      'В профиль попадёт: «Сроки — подтверждено кейсом». Верно?',
    );
    expect(profileLine('Сроки', 'partial')).toBe(
      'В профиль попадёт: «Сроки — частично подтверждено кейсом». Верно?',
    );
    expect(profileLine('Сроки', 'not_confirmed')).toBeNull();
  });

  it('lists role skills with the current case marked', () => {
    expect(runSkillRows(run())).toEqual([
      { id: 's-Go', name: 'Go', earned: true, sub: null },
      { id: 's-Сроки', name: 'Сроки', earned: false, sub: 'Идёт сейчас · 5 из 5' },
      { id: 's-K8s', name: 'Kubernetes', earned: false, sub: null },
    ]);
    expect(runSkillRows(run({ status: 'complete' }))[1]?.sub).toBeNull();
  });

  it('builds the check path with an optional role', () => {
    expect(skillCheckPath()).toBe('/app/career/skills');
    expect(skillCheckPath('Тимлид QA')).toBe(
      '/app/career/skills?role=%D0%A2%D0%B8%D0%BC%D0%BB%D0%B8%D0%B4%20QA',
    );
  });
});
