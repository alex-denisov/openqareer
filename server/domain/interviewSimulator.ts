export const INTERVIEW_QUESTION_COUNT = 5;

export type InterviewQuestionType = 'behavioral' | 'system_design';
export type InterviewAnswerMode = 'text' | 'voice';
export type InterviewSessionStatus = 'active' | 'paused' | 'interrupted' | 'completed';
export type InterviewAction = 'next' | 'skip' | 'pause' | 'resume' | 'interrupt' | 'finish';

export interface InterviewStorySource {
  readonly id: string;
  readonly title: string;
  readonly sourceFactIds: readonly string[];
}

export interface InterviewQuestion {
  readonly id: string;
  readonly type: InterviewQuestionType;
  readonly topic: string;
  readonly prompt: string;
  readonly storyId: string | null;
  readonly storyTitle: string | null;
  readonly sourceFactIds: readonly string[];
  readonly skipped: boolean;
  readonly answer?: {
    readonly text: string;
    readonly elapsedSeconds: number;
    readonly evaluation: InterviewAnswerEvaluation;
  };
}

export interface InterviewAnswerEvaluation {
  readonly rubric: 'star' | 'system_design';
  readonly criteria: Readonly<Record<string, { readonly points: 0 | 1 | 2; readonly reason: string }>>;
  readonly points: number;
  readonly maxPoints: number;
  readonly feedback?: string;
}

export interface InterviewSession {
  readonly id: string;
  readonly version: number;
  readonly status: InterviewSessionStatus;
  readonly mode: InterviewAnswerMode;
  readonly roleTitle: string;
  readonly applicationId: string | null;
  readonly vacancyTitle: string | null;
  readonly questionTypes: readonly InterviewQuestionType[];
  readonly stressMode: boolean;
  readonly questions: readonly InterviewQuestion[];
  readonly currentQuestionIndex: number;
  readonly startedAt: string;
  readonly updatedAt: string;
}

export interface BuildInterviewQuestionPlanInput {
  readonly roleTitle: string;
  readonly vacancyTitle?: string;
  readonly questionTypes: readonly InterviewQuestionType[];
  readonly stressMode: boolean;
  readonly stories: readonly InterviewStorySource[];
  readonly verifiedSkills?: readonly string[];
  readonly questionIds: readonly string[];
}

export interface CreateInterviewSessionInput extends BuildInterviewQuestionPlanInput {
  readonly id: string;
  readonly mode: InterviewAnswerMode;
  readonly applicationId: string | null;
  readonly now: string;
}


type CriterionDefinition = readonly [
  string,
  readonly string[],
  readonly string[],
  readonly [string, string, string],
];

const RUBRIC_CRITERIA = {
  behavioral: [
    ['situation', ['ситуац', 'проект', 'команд', 'когда', 'в компании'], ['в проекте', 'в команде', 'в компании', 'когда'], ['Не описан контекст ситуации.', 'Уточните контекст и ограничения.', 'Контекст ситуации описан.']],
    ['task', ['задач', 'цель', 'нужно', 'требован', 'проблем'], ['без потери', 'срок', 'качества', 'критер', 'ограничен'], ['Не обозначена задача.', 'Уточните цель и критерий успеха.', 'Задача и критерий успеха обозначены.']],
    ['action', ['я ', 'мы ', 'сделал', 'настроил', 'внедрил', 'разработал', 'собрал', 'спроектировал'], ['настроил', 'автоматизир', 'внедрил', 'разработал', 'собрал', 'оптимизировал'], ['Не выделены ваши действия.', 'Уточните ваш личный вклад.', 'Личные действия описаны конкретно.']],
    ['result', ['результ', 'сократ', 'увелич', 'снизил', 'достиг', 'получил'], ['сократ', 'увелич', 'снизил', 'достиг', 'получил'], ['Не указан результат.', 'Добавьте наблюдаемый результат.', 'Результат описан.']],
  ],
  system_design: [
    ['requirements', ['требован', 'нагруз', 'пользоват', 'latency', 'slo', 'throughput'], ['slo', 'latency', 'нагруз', 'throughput'], ['Не уточнены требования.', 'Уточните объём и ограничения.', 'Требования и ограничения названы.']],
    ['architecture', ['архитект', 'сервис', 'компонент', 'база', 'очеред', 'кэш', 'database', 'queue'], ['раздел', 'компонент', 'очеред', 'кэш', 'database', 'queue'], ['Не описаны компоненты решения.', 'Назовите границы компонентов и потоки данных.', 'Компоненты решения обозначены.']],
    ['tradeoffs', ['компромисс', 'альтернатив', 'выбрал', 'почему', 'tradeoff', 'consistency'], ['компромисс', 'альтернатив', 'выбрал', 'почему'], ['Не объяснён выбор.', 'Сравните выбранный вариант с альтернативой.', 'Выбор и компромисс объяснены.']],
    ['operations', ['монитор', 'резерв', 'повтор', 'ошиб', 'отказ', 'масштаб', 'recovery'], ['метрик', 'алерт', 'повтор', 'резерв', 'recovery'], ['Не рассмотрена эксплуатация.', 'Добавьте отказоустойчивость и мониторинг.', 'Эксплуатация учтена.']],
  ],
} satisfies Record<InterviewQuestionType, readonly CriterionDefinition[]>;

function scoreCriterion(
  answer: string,
  cues: readonly string[],
  detailCues: readonly string[],
  reasons: readonly [string, string, string],
): { points: 0 | 1 | 2; reason: string } {
  const normalized = answer.toLocaleLowerCase('ru-RU');
  const hasCue = cues.some((cue) => normalized.includes(cue));
  if (!hasCue) return { points: 0, reason: reasons[0] };
  const hasDetail = detailCues.some((cue) => normalized.includes(cue));
  return hasDetail
    ? { points: 2, reason: reasons[2] }
    : { points: 1, reason: reasons[1] };
}

export function buildInterviewQuestionPlan(
  input: BuildInterviewQuestionPlanInput,
): InterviewQuestion[] {
  const questionTypes: readonly InterviewQuestionType[] = input.questionTypes.length
    ? input.questionTypes
    : ['behavioral'];
  const count = Math.min(INTERVIEW_QUESTION_COUNT, input.questionIds.length);
  const target = input.vacancyTitle
    ? `для вакансии «${input.vacancyTitle}»`
    : `для роли «${input.roleTitle}»`;
  return Array.from({ length: count }, (_, index) => {
    const type = questionTypes[index % questionTypes.length];
    const story = type === 'behavioral' && input.stories.length
      ? input.stories[index % input.stories.length]
      : undefined;
    const skill = input.verifiedSkills?.length
      ? input.verifiedSkills[index % input.verifiedSkills.length]
      : null;
    const designScope = skill ? ` с использованием ${skill}` : '';
    const prompt = type === 'system_design'
      ? `Для ${target}${designScope} спроектируйте сервис уведомлений с повторной доставкой и защитой от дублей. Начните с требований и ограничений.`
      : story
        ? `В истории «${story.title}» опишите ситуацию, задачу, личные действия и проверяемый результат.`
        : 'Расскажите о профессиональной ситуации, где вы решили сложную задачу. Опишите ситуацию, цель, свои действия и результат из собственного опыта.';
    return {
      id: input.questionIds[index],
      type,
      topic: type,
      prompt: input.stressMode ? `${prompt} Уточните ограничения и обоснуйте выбранный подход.` : prompt,
      storyId: story?.id ?? null,
      storyTitle: story?.title ?? null,
      sourceFactIds: story?.sourceFactIds ?? [],
      skipped: false,
    };
  });
}

export function createInterviewSession(input: CreateInterviewSessionInput): InterviewSession {
  const questions = buildInterviewQuestionPlan(input);
  if (questions.length === 0) throw new Error('interview_questions_required');
  return {
    id: input.id,
    version: 1,
    status: 'active',
    mode: input.mode,
    roleTitle: input.roleTitle,
    applicationId: input.applicationId,
    vacancyTitle: input.vacancyTitle ?? null,
    questionTypes: [...input.questionTypes],
    stressMode: input.stressMode,
    questions,
    currentQuestionIndex: 0,
    startedAt: input.now,
    updatedAt: input.now,
  };
}

export function scoreInterviewAnswer(
  answer: string,
  type: InterviewQuestionType,
): InterviewAnswerEvaluation {
  const text = answer.trim().toLocaleLowerCase('ru-RU');
  const criteria = Object.fromEntries(
    RUBRIC_CRITERIA[type].map(([name, cues, details, reasons]) => [
      name,
      scoreCriterion(text, cues, details, reasons),
    ]),
  );
  if (type === 'behavioral' && /\b\d+(?:[.,]\d+)?\s?(?:%|дн|дней|час|человек|млн|тыс)?\b/u.test(text)) {
    criteria.result = { points: 2, reason: 'Указан числовой результат.' };
  }
  const points = Object.values(criteria).reduce((total, criterion) => total + criterion.points, 0);
  return {
    rubric: type === 'behavioral' ? 'star' : 'system_design',
    criteria,
    points,
    maxPoints: Object.keys(criteria).length * 2,
  };
}

export function recordInterviewAnswer(
  session: InterviewSession,
  answer: string,
  elapsedSeconds: number,
  evaluation: InterviewAnswerEvaluation,
  now: string,
): InterviewSession {
  if (session.status !== 'active') throw new Error('interview_session_not_active');
  const question = session.questions[session.currentQuestionIndex];
  if (!question) throw new Error('interview_question_not_found');
  const text = answer.trim();
  if (!text) throw new Error('interview_answer_required');
  if (!Number.isInteger(elapsedSeconds) || elapsedSeconds < 0 || elapsedSeconds > 3_600) {
    throw new Error('interview_elapsed_seconds_invalid');
  }
  if (evaluation.rubric !== (question.type === 'behavioral' ? 'star' : 'system_design')) {
    throw new Error('interview_evaluation_rubric_mismatch');
  }
  const questions = session.questions.map((item, index) =>
    index === session.currentQuestionIndex
      ? { ...item, skipped: false, answer: { text, elapsedSeconds, evaluation } }
      : item,
  );
  return {
    ...session,
    version: session.version + 1,
    questions,
    updatedAt: now,
  };
}

export function transitionInterviewSession(
  session: InterviewSession,
  action: InterviewAction,
  now: string,
): InterviewSession {
  if (session.status === 'completed') throw new Error('interview_session_completed');
  if (action === 'pause' || action === 'interrupt') {
    if (session.status !== 'active') throw new Error('interview_session_not_active');
    return { ...session, status: action === 'pause' ? 'paused' : 'interrupted', version: session.version + 1, updatedAt: now };
  }
  if (action === 'resume') {
    if (session.status !== 'paused' && session.status !== 'interrupted') {
      throw new Error('interview_session_not_resumable');
    }
    return { ...session, status: 'active', version: session.version + 1, updatedAt: now };
  }
  if (action === 'finish') {
    return { ...session, status: 'completed', version: session.version + 1, updatedAt: now };
  }
  if (session.status !== 'active') throw new Error('interview_session_not_active');

  const current = session.questions[session.currentQuestionIndex];
  if (!current) throw new Error('interview_question_not_found');
  if (action === 'next' && !current.answer && !current.skipped) {
    throw new Error('interview_answer_required');
  }
  const questions = action === 'skip'
    ? session.questions.map((question, index) =>
        index === session.currentQuestionIndex ? { ...question, skipped: true } : question,
      )
    : session.questions;
  const nextIndex = session.currentQuestionIndex + 1;
  const completed = nextIndex >= questions.length;
  return {
    ...session,
    version: session.version + 1,
    status: completed ? 'completed' : 'active',
    questions,
    currentQuestionIndex: completed ? session.currentQuestionIndex : nextIndex,
    updatedAt: now,
  };
}

export function summarizeInterviewTopics(
  session: InterviewSession,
): Array<{ topic: string; answered: number; points: number; maxPoints: number }> {
  return session.questionTypes.map((topic) => {
    const questions = session.questions.filter((question) => question.type === topic && question.answer);
    return {
      topic,
      answered: questions.length,
      points: questions.reduce((total, question) => total + (question.answer?.evaluation.points ?? 0), 0),
      maxPoints: questions.reduce((total, question) => total + (question.answer?.evaluation.maxPoints ?? 0), 0),
    };
  });
}
