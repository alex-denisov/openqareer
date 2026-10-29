import { getAvailableSkillQuizzes, quizCoversSkill } from '../../src/services/hhSkillQuizzes';
import { GENERATED_QUIZ_SOURCE } from './generatedSkillQuiz';
import type { ResumeDraft, ResumeSkillInput } from './resumeDraft';

/**
 * Ремонт навыков, записанных старым банком из 7 квизов (блок A, пакет 3).
 * Панель слала имя квиза («Docker & Контейнеризация сервисов»), и у кандидата
 * появлялся подтверждённый дубль рядом с «Docker» без статуса. Источник
 * «Банк квизов LinkedIn/hh.ru» неправдив: вопросы были наши.
 */

const LEGACY_SOURCES = new Set(['Банк квизов LinkedIn', 'Банк квизов hh.ru']);
const CONFIRMED = 'подтверждён';

export type LegacyQuizRepairChange =
  | { readonly kind: 'merged'; readonly from: string; readonly into: string }
  | { readonly kind: 'renamed'; readonly from: string; readonly to: string }
  | { readonly kind: 'relabeled'; readonly skill: string };

export interface LegacyQuizRepair {
  readonly draft: ResumeDraft;
  readonly changes: readonly LegacyQuizRepairChange[];
}

function quizByTitle(name: string) {
  return getAvailableSkillQuizzes().find((quiz) => quiz.title === name);
}

function withVerdict(target: ResumeSkillInput, verdict: ResumeSkillInput): ResumeSkillInput {
  if (target.status === CONFIRMED && verdict.status !== CONFIRMED) return target;
  return {
    ...target,
    status: verdict.status,
    source: GENERATED_QUIZ_SOURCE,
    ...(verdict.verifiedAt ? { verifiedAt: verdict.verifiedAt } : {}),
  };
}

export function repairLegacyQuizSkills(draft: ResumeDraft): LegacyQuizRepair {
  const skills = draft.skills ?? [];
  const changes: LegacyQuizRepairChange[] = [];
  let next = [...skills];
  for (const duplicate of skills) {
    const quiz = quizByTitle(duplicate.name);
    if (!quiz) continue;
    const target = next.find((skill) => skill !== duplicate && quizCoversSkill(quiz, skill.name));
    if (target) {
      next = next
        .filter((skill) => skill !== duplicate)
        .map((skill) => (skill === target ? withVerdict(target, duplicate) : skill));
      changes.push({ kind: 'merged', from: duplicate.name, into: target.name });
    } else {
      const renamed = { ...duplicate, name: quiz.skill, source: GENERATED_QUIZ_SOURCE };
      next = next.map((skill) => (skill === duplicate ? renamed : skill));
      changes.push({ kind: 'renamed', from: duplicate.name, to: quiz.skill });
    }
  }
  next = next.map((skill) => {
    if (!skill.source || !LEGACY_SOURCES.has(skill.source)) return skill;
    changes.push({ kind: 'relabeled', skill: skill.name });
    return { ...skill, source: GENERATED_QUIZ_SOURCE };
  });
  return changes.length === 0 ? { draft, changes } : { draft: { ...draft, skills: next }, changes };
}
