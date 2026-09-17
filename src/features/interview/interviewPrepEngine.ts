import type { CandidateMemory } from '../coach/coachApi';

export interface InterviewVacancyTarget {
  readonly id: string;
  readonly title: string;
  readonly company?: string;
  readonly descriptionSummary?: string;
  readonly skills?: readonly string[];
  readonly location?: string;
  readonly isRemote?: boolean;
}

export interface StarAnswer {
  readonly situation: string;
  readonly task: string;
  readonly action: string;
  readonly result: string;
}

export interface StarQuestion {
  readonly id: string;
  readonly category: 'behavioral' | 'technical' | 'motivation';
  readonly question: string;
  readonly starAnswer: StarAnswer;
  readonly usedEvidenceIds: readonly string[];
}

export interface CompanyOverview {
  readonly summary: string;
  readonly challenges: readonly string[];
  readonly techStack: readonly string[];
}

export interface InterviewerFocus {
  readonly targetRole: string;
  readonly recommendations: readonly string[];
  readonly keyThemes: readonly string[];
}

export interface InterviewPrepBrief {
  readonly companyOverview: CompanyOverview;
  readonly interviewerFocus: InterviewerFocus;
  readonly starQuestions: readonly StarQuestion[];
  readonly counterQuestions: readonly string[];
}

export interface InterviewPrepInput {
  readonly vacancy: InterviewVacancyTarget;
  readonly candidateName?: string;
  readonly facts: readonly CandidateMemory[];
}

export function generateInterviewPrepBrief(input: InterviewPrepInput): InterviewPrepBrief {
  const { vacancy, facts } = input;
  return {
    companyOverview: buildCompanyOverview(vacancy),
    interviewerFocus: buildInterviewerFocus(vacancy),
    starQuestions: buildStarQuestions(vacancy, facts),
    counterQuestions: buildCounterQuestions(vacancy),
  };
}

function buildCompanyOverview(vacancy: InterviewVacancyTarget): CompanyOverview {
  const company = vacancy.company?.trim() || 'Работодатель';
  const stack = resolveTechStack(vacancy);
  const desc = vacancy.descriptionSummary?.trim();
  const summary = desc
    ? `Компания ${company} открыла позицию «${vacancy.title}». Ключевой контекст: ${desc}`
    : `Компания ${company} открыла поиск специалиста на позицию «${vacancy.title}».`;

  return {
    summary,
    challenges: [
      'Масштабирование сервисов и оптимизация ключевых показателей производительности',
      'Обеспечение отказоустойчивости и надежности в production-контуре',
      'Повышение скорости поставки ценности без деградации качества архитектуры',
    ],
    techStack: stack,
  };
}

function resolveTechStack(vacancy: InterviewVacancyTarget): readonly string[] {
  if (vacancy.skills && vacancy.skills.length > 0) {
    return vacancy.skills;
  }
  const desc = vacancy.descriptionSummary ?? '';
  const matched: string[] = [];
  const candidates = ['TypeScript', 'React', 'Node.js', 'Go', 'Python', 'PostgreSQL', 'Docker', 'Kubernetes'];
  for (const c of candidates) {
    if (new RegExp(`\\b${c}\\b`, 'i').test(desc)) {
      matched.push(c);
    }
  }
  return matched.length > 0 ? matched : ['Современный инженерный стек', 'Архитектурные паттерны'];
}

function buildInterviewerFocus(vacancy: InterviewVacancyTarget): InterviewerFocus {
  const company = vacancy.company?.trim() || 'компании';
  return {
    targetRole: vacancy.title,
    recommendations: [
      'Подкрепляйте каждый тезис измеримыми цифрами и конкретными фактами из практики.',
      'Раскрывайте инженерное мышление: компромиссы, риски и обоснование выбранных решений.',
      `Демонстрируйте искренний интерес к продуктовым задачам и масштабу ${company}.`,
    ],
    keyThemes: [
      'Архитектурная надежность, масштабируемость и оптимизация',
      'Лидерство, кросс-функциональное взаимодействие и командные стандарты',
      'Управление техническим долгом и культура тестирования',
    ],
  };
}

function buildStarQuestions(
  vacancy: InterviewVacancyTarget,
  facts: readonly CandidateMemory[],
): readonly StarQuestion[] {
  const confirmed = facts.filter((f) => f.status === 'confirmed' || f.confidence === 'candidate-confirmed');
  const achieveFact = confirmed.find((f) => f.domain === 'outcome') ?? confirmed[0];
  const expFact =
    confirmed.find(
      (f) => (f.domain === 'responsibility' || f.domain === 'role-evidence') && f.id !== achieveFact?.id,
    ) ?? confirmed[1];
  const skillFact =
    confirmed.find((f) => f.domain === 'skill' && f.id !== achieveFact?.id && f.id !== expFact?.id) ??
    confirmed[2];

  return [
    buildTechnicalQuestion(vacancy, achieveFact),
    buildBehavioralQuestion(vacancy, expFact),
    buildMotivationQuestion(vacancy, skillFact),
  ];
}

function buildTechnicalQuestion(
  vacancy: InterviewVacancyTarget,
  fact?: CandidateMemory,
): StarQuestion {
  if (fact) {
    return {
      id: 'star-q1-tech',
      category: 'technical',
      question: `Опишите сложную архитектурную задачу или проблему производительности, которую вы успешно решили.`,
      starAnswer: {
        situation: `В рамках проекта потребовалось решить задачу оптимизации производительности и надежности.`,
        task: `Спроектировать и реализовать устойчивое решение, удовлетворяющее требованиям масштабируемости.`,
        action: fact.statement,
        result: `Достигнут подтверждённый измеримый результат: ${fact.statement}`,
      },
      usedEvidenceIds: [fact.id],
    };
  }
  return {
    id: 'star-q1-tech',
    category: 'technical',
    question: `Опишите сложную архитектурную задачу или проблему производительности, которую вы успешно решили.`,
    starAnswer: {
      situation: `В практике разработки возникают вызовы, требующие оптимизации системных параметров.`,
      task: `Локализовать причину замедления и сформировать план технических улучшений.`,
      action: `Провести профилирование, выявить критические участки и применить проверенные инженерные паттерны.`,
      result: `Добавьте в профиль подтверждённые факты с цифрами метрик (ускорение, снижение нагрузки) для опоры.`,
    },
    usedEvidenceIds: [],
  };
}

function buildBehavioralQuestion(
  vacancy: InterviewVacancyTarget,
  fact?: CandidateMemory,
): StarQuestion {
  if (fact) {
    return {
      id: 'star-q2-behavioral',
      category: 'behavioral',
      question: `Расскажите о ситуации, когда вам пришлось согласовывать сложное решение или координировать команду.`,
      starAnswer: {
        situation: `При выполнении критической продуктовой задачи возникла необходимость синхронизации подходов.`,
        task: `Выработать единый вектор работы и защитить архитектурное решение перед коллегами.`,
        action: fact.statement,
        result: `Задачи выполнены в срок с соблюдением стандартов качества инженерных процессов.`,
      },
      usedEvidenceIds: [fact.id],
    };
  }
  return {
    id: 'star-q2-behavioral',
    category: 'behavioral',
    question: `Расскажите о ситуации, когда вам пришлось согласовывать сложное решение или координировать команду.`,
    starAnswer: {
      situation: `При совместной разработке неизбежны расхождения в оценке архитектурных компромиссов.`,
      task: `Организовать конструктивный диалог и прийти к согласованному плану действий.`,
      action: `Собрать объективные аргументы, провести открытое обсуждение и зафиксировать договоренности.`,
      result: `Внесите в профиль подтверждённые факты командной работы и лидерства для наглядности вашего опыта.`,
    },
    usedEvidenceIds: [],
  };
}

function buildMotivationQuestion(
  vacancy: InterviewVacancyTarget,
  fact?: CandidateMemory,
): StarQuestion {
  const company = vacancy.company?.trim() || 'этой компании';
  if (fact) {
    return {
      id: 'star-q3-motivation',
      category: 'motivation',
      question: `Почему вам интересна позиция «${vacancy.title}» в ${company}?`,
      starAnswer: {
        situation: `Изучил цели компании и требования к роли «${vacancy.title}».`,
        task: `Применить накопленную экспертизу для решения приоритетных задач бизнеса.`,
        action: `Интегрировать подтверждённые навыки (${fact.statement}) в развитие платформы.`,
        result: `Быстрый вход в контекст и создание ощутимой ценности для пользователей и команды.`,
      },
      usedEvidenceIds: [fact.id],
    };
  }
  return {
    id: 'star-q3-motivation',
    category: 'motivation',
    question: `Почему вам интересна позиция «${vacancy.title}» в ${company}?`,
    starAnswer: {
      situation: `Слежу за развитием продуктовой сферы и технологическими вызовами ${company}.`,
      task: `Найти применение своим сильным сторонам в решении задач компании.`,
      action: `Погрузиться в специфику домена и применить современный стек на реальных нагрузках.`,
      result: `Внесите в профиль подтверждённые карьерные цели и навыки для точной калибровки интереса.`,
    },
    usedEvidenceIds: [],
  };
}

function buildCounterQuestions(vacancy: InterviewVacancyTarget): readonly string[] {
  const company = vacancy.company?.trim() || 'компании';
  return [
    `Какие ключевые цели и критерии успеха стоят перед инженером на позиции «${vacancy.title}» на первые 3-6 месяцев?`,
    `Как в ${company} устроен процесс принятия решений между продуктом и технической экспертизой?`,
    `С какими главными техническими вызовами или ограничениями сталкивается сейчас архитектура сервисов?`,
    `Каковы текущие стандарты инженерного качества: покрытие тестами, автоматизация CI/CD и наблюдаемость в production?`,
    `Как в инженерной культуре ${company} выстроено профессиональное развитие специалистов и обмен опытом?`,
  ];
}
