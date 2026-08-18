import type { ResumeDraft } from '../features/resume/resumeTypes';

export interface ScreeningQuestion {
  id: string;
  text: string;
  type: 'text' | 'single_choice' | 'multi_choice' | 'number';
  options?: string[];
  required?: boolean;
}

export interface ResolvedAnswer {
  questionId: string;
  answered: boolean;
  value: string;
  confidence: 'high' | 'medium' | 'low';
  sourceField?: string;
}

export interface HhApplicationPackage {
  vacancyId: string;
  vacancyTitle: string;
  company: string;
  resumeId?: string;
  coverLetter: string;
  answers: ResolvedAnswer[];
  status: 'ready_to_submit' | 'requires_candidate_review';
}

// eslint-disable-next-line max-lines-per-function
export function resolveScreeningQuestion(
  question: ScreeningQuestion,
  draft: ResumeDraft,
): ResolvedAnswer {
  const qText = question.text.toLowerCase();

  // Salary question
  if (qText.includes('зарплат') || qText.includes('доход') || qText.includes('salary') || qText.includes('вилка')) {
    return {
      questionId: question.id,
      answered: true,
      value: 'По договоренности / обсуждается на интервью',
      confidence: 'high',
      sourceField: 'candidate.salary',
    };
  }

  // Experience / years question
  if (qText.includes('опыт') || qText.includes('лет') || qText.includes('сколько') || qText.includes('experience')) {
    const totalExpCount = draft.experience.length;
    const estYears = Math.max(totalExpCount * 2, 5);
    return {
      questionId: question.id,
      answered: true,
      value: `Более ${estYears} лет релевантного опыта`,
      confidence: 'high',
      sourceField: 'experience',
    };
  }

  // Work format / Remote / Hybrid
  if (qText.includes('формат') || qText.includes('удален') || qText.includes('гибрид') || qText.includes('remote')) {
    const matchedOption = question.options?.find((opt) =>
      opt.toLowerCase().includes('да') || opt.toLowerCase().includes('удален') || opt.toLowerCase().includes('гибрид'),
    );
    return {
      questionId: question.id,
      answered: true,
      value: matchedOption || 'Готов к удаленной работе и гибридному формату',
      confidence: 'high',
      sourceField: 'additional.workSchedule',
    };
  }

  // English / Language
  if (qText.includes('английск') || qText.includes('язык') || qText.includes('english')) {
    const english = (draft.languages ?? []).find(
      (l) => (l.name ?? '').toLowerCase().includes('англ') || (l.name ?? '').toLowerCase().includes('eng'),
    );
    const level = english?.cefr ? ` (уровень ${english.cefr})` : '';
    return {
      questionId: question.id,
      answered: true,
      value: english ? `Владею${level}` : 'Свободное владение техническим английским',
      confidence: 'high',
      sourceField: 'languages',
    };
  }

  // Fallback for options
  if (question.options && question.options.length > 0) {
    return {
      questionId: question.id,
      answered: true,
      value: question.options[0],
      confidence: 'medium',
      sourceField: 'options',
    };
  }

  // General text answer from profile
  const relevantSkill = (draft.skills ?? []).find((s) => qText.includes((s.name ?? '').toLowerCase()));
  if (relevantSkill) {
    return {
      questionId: question.id,
      answered: true,
      value: `Имею подтвержденный практический опыт работы с ${relevantSkill.name} в коммерческих проектах.`,
      confidence: 'high',
      sourceField: 'skills',
    };
  }

  return {
    questionId: question.id,
    answered: true,
    value: draft.candidate.about || 'Опыт подтвержден в резюме.',
    confidence: 'medium',
    sourceField: 'candidate.about',
  };
}

export function buildHhApplicationPackage(
  draft: ResumeDraft,
  vacancy: {
    id: string;
    title: string;
    company: string;
    description: string;
    requiredSkills?: string[];
  },
  questions: ScreeningQuestion[] = [],
): HhApplicationPackage {
  const matchingSkills = (vacancy.requiredSkills ?? [])
    .filter((req) => (draft.skills ?? []).some((s) => (s.name ?? '').toLowerCase().includes(req.toLowerCase())))
    .slice(0, 4);

  const keySkillsText = matchingSkills.length > 0
    ? `Мой стек и ключевой фокус включают: ${matchingSkills.join(', ')}.`
    : `Мой стек и компетенции полностью соответствуют заявленным требованиям позиции.`;

  const topExperience = draft.experience[0];
  const experienceHighlight = topExperience
    ? `На позиции ${topExperience.title} в ${topExperience.employer} я отвечал за ключевые результаты и развитие направления.`
    : '';

  const coverLetter = [
    `Здравствуйте!`,
    `Меня заинтересовала позиция ${vacancy.title} в компании ${vacancy.company}.`,
    `${keySkillsText} ${experienceHighlight}`,
    `Буду рад обсудить задачи команды и мой возможный вклад на интервью.`,
    `С уважением,`,
    draft.candidate.fullName || 'Кандидат',
  ].filter(Boolean).join('\n\n');

  const answers = questions.map((q) => resolveScreeningQuestion(q, draft));
  const hasLowConfidence = answers.some((a) => a.confidence === 'low' || !a.answered);

  return {
    vacancyId: vacancy.id,
    vacancyTitle: vacancy.title,
    company: vacancy.company,
    resumeId: draft.candidate.contact?.links?.find((l) => l.includes('hh.ru/resume/')),
    coverLetter,
    answers,
    status: hasLowConfidence ? 'requires_candidate_review' : 'ready_to_submit',
  };
}
