import type {
  RoleSkillAssessmentRun,
  RoleSkillEvaluation,
  RoleSkillGrade,
} from '../../../../server/domain/roleSkillAssessment';
import { buildNodePath } from '../routes';

type RunCase = RoleSkillAssessmentRun['cases'][number];

const totalQuestions = (run: RoleSkillAssessmentRun): number =>
  run.dialogueQuestions.length + run.cases.length;

/** Разговор о роли и кейсы идут одним рядом вопросов. */
export function dialogueEyebrow(run: RoleSkillAssessmentRun): string {
  return `О вашем опыте · вопрос ${run.currentDialogueIndex + 1} из ${totalQuestions(run)}`;
}

export function caseEyebrow(run: RoleSkillAssessmentRun, record: RunCase): string {
  const index = run.cases.findIndex((item) => item.assessmentCase.id === record.assessmentCase.id);
  const number = run.dialogueQuestions.length + Math.max(index, 0) + 1;
  return `${record.assessmentCase.skillName} · вопрос ${number} из ${totalQuestions(run)}`;
}

function points(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return 'пункт';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'пункта';
  return 'пунктов';
}

/** Заголовок итога кейса: сколько пунктов ответ раскрыл. */
export function resultTitle(evaluation: Pick<RoleSkillEvaluation, 'criteria'>): string {
  const total = evaluation.criteria.length;
  const done = evaluation.criteria.filter((item) => item.grade === 'confirmed').length;
  if (done === total) return `Раскрыты все ${total} ${points(total)}`;
  if (done === 0) return 'Пункты не раскрыты';
  return `${done === 1 ? 'Раскрыт' : 'Раскрыто'} ${done} ${points(done)} из ${total}`;
}

export interface GradeTag {
  readonly tone: 'ok' | 'part' | 'miss';
  readonly text: string;
}

const GRADE_TAG: Readonly<Record<RoleSkillGrade, GradeTag>> = {
  confirmed: { tone: 'ok', text: 'раскрыто' },
  partial: { tone: 'part', text: 'частично' },
  not_confirmed: { tone: 'miss', text: 'не раскрыто' },
};

export const gradeTag = (grade: RoleSkillGrade): GradeTag => GRADE_TAG[grade];

/** Что запишется в профиль после кейса; неподтверждённый навык в профиль не идёт. */
export function profileLine(skill: string, grade: RoleSkillGrade): string | null {
  if (grade === 'not_confirmed') return null;
  const mark = grade === 'confirmed' ? 'подтверждено кейсом' : 'частично подтверждено кейсом';
  return `В профиль попадёт: «${skill} — ${mark}». Верно?`;
}

export interface SkillRow {
  readonly id: string;
  readonly name: string;
  readonly earned: boolean;
  readonly sub: string | null;
}

export function runSkillRows(run: RoleSkillAssessmentRun): readonly SkillRow[] {
  const current = run.status === 'cases' ? run.cases[run.currentCaseIndex] : undefined;
  return run.skills.map((skill) => ({
    id: skill.id,
    name: skill.name,
    earned: skill.grade === 'confirmed',
    sub:
      current && skill.caseId === current.assessmentCase.id
        ? `Идёт сейчас · ${caseEyebrow(run, current).split('вопрос ')[1]}`
        : null,
  }));
}

/** Путь C04; роль — та, что нажата в «Карьере». */
export function skillCheckPath(role?: string): string {
  const path = buildNodePath('c04');
  return role ? `${path}?role=${encodeURIComponent(role)}` : path;
}
