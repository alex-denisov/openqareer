import type { CandidateMemory } from '../coach/coachApi';
import { isResumeEvidenceEligible } from '../../../server/domain/resumeEvidenceEligibility';

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
  readonly sourceNote: string;
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

function isEngineeringRole(vacancy: InterviewVacancyTarget): boolean {
  const text = [vacancy.title, ...(vacancy.skills ?? []), vacancy.descriptionSummary ?? ''].join(' ');
  return /engineer|developer|разработ|инженер|architect|devops|backend|frontend|data engineer/i.test(text);
}

function buildCompanyOverview(vacancy: InterviewVacancyTarget): CompanyOverview {
  const company = vacancy.company?.trim() || 'Работодатель';
  const stack = resolveTechStack(vacancy);
  const engineering = isEngineeringRole(vacancy);
  const desc = vacancy.descriptionSummary?.trim();
  const summary = desc
    ? `Компания ${company} открыла позицию «${vacancy.title}». Ключевой контекст: ${desc}`
    : `Компания ${company} открыла поиск специалиста на позицию «${vacancy.title}».`;

  return {
    summary,
    sourceNote:
      'Основано на тексте этой вакансии и переданных требованиях. Новости компании и профиль интервьюера не подключены.',
    challenges: engineering
      ? [
          'Масштабирование сервисов и оптимизация ключевых показателей производительности',
          'Обеспечение отказоустойчивости и надежности в production-контуре',
          'Повышение скорости поставки ценности без деградации качества архитектуры',
        ]
      : [
          'Критерии успеха и приоритеты роли на первые месяцы',
          'Ключевые процессы команды и взаимодействие со смежными функциями',
          'Ожидаемые результаты и доступные ресурсы для этой позиции',
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
  return matched;
}

function buildInterviewerFocus(vacancy: InterviewVacancyTarget): InterviewerFocus {
  const company = vacancy.company?.trim() || 'компании';
  const engineering = isEngineeringRole(vacancy);
  return {
    targetRole: vacancy.title,
    recommendations: [
      'Подкрепляйте каждый тезис измеримыми цифрами и конкретными фактами из практики.',
      engineering
        ? 'Раскрывайте инженерное мышление: компромиссы, риски и обоснование выбранных решений.'
        : 'Раскрывайте ход принятия решений, критерии качества и взаимодействие с командой.',
      `Демонстрируйте искренний интерес к продуктовым задачам и масштабу ${company}.`,
    ],
    keyThemes: [
      ...(engineering
        ? [
            'Архитектурная надежность, масштабируемость и оптимизация',
            'Лидерство, кросс-функциональное взаимодействие и командные стандарты',
            'Управление техническим долгом и культура тестирования',
          ]
        : [
            'Критерии качества и принятия решений в команде',
            'Кросс-функциональное взаимодействие и зона ответственности роли',
            'Приоритеты, риски и способы измерить результат',
          ]),
    ],
  };
}

function buildStarQuestions(
  vacancy: InterviewVacancyTarget,
  facts: readonly CandidateMemory[],
): readonly StarQuestion[] {
  const confirmed = facts.filter(isResumeEvidenceEligible);
  const achieveFact = confirmed.find((f) => f.domain === 'outcome') ?? confirmed[0];
  const expFact =
    confirmed.find(
      (f) => (f.domain === 'responsibility' || f.domain === 'role-evidence') && f.id !== achieveFact?.id,
    ) ?? confirmed[1];
  const skillFact =
    confirmed.find((f) => f.domain === 'skill' && f.id !== achieveFact?.id && f.id !== expFact?.id) ??
    confirmed[2];

  const core = [
    buildTechnicalQuestion(vacancy, achieveFact),
    buildBehavioralQuestion(vacancy, expFact),
    buildMotivationQuestion(vacancy, skillFact),
  ];
  const likelyQuestions = [
    'Какой результат этой роли вы считаете самым важным в первые месяцы?',
    'Как вы принимаете решения, когда данных недостаточно?',
    'Расскажите о ситуации, когда пришлось менять план после обратной связи.',
    'Как вы оцениваете качество своей работы?',
    'Как выстраиваете взаимодействие с коллегами и заказчиками?',
    'Какие ограничения или риски вы учитываете в этой роли?',
    'Какой навык вы развивали в последнее время и зачем?',
  ];
  return [
    ...core,
    ...likelyQuestions.map((question, index) => ({
      id: `star-q${index + 4}-likely`,
      category: index % 2 === 0 ? ('behavioral' as const) : ('motivation' as const),
      question,
      starAnswer: unknownStarAnswer(),
      usedEvidenceIds: [],
    })),
  ];
}

function unknownStarAnswer(): StarAnswer {
  return {
    situation: 'Контекст ситуации в подтверждённых данных не зафиксирован; выберите собственный пример.',
    task: 'Задача и критерии успеха в подтверждённых данных не зафиксированы; уточните их перед встречей.',
    action: 'Действия кандидата в профиле не зафиксированы; не подставляйте шаблонный ответ.',
    result: 'Результат в подтверждённых данных не зафиксирован; добавьте его только после подтверждения.',
  };
}

function buildTechnicalQuestion(
  vacancy: InterviewVacancyTarget,
  fact?: CandidateMemory,
): StarQuestion {
  const engineering = isEngineeringRole(vacancy);
  if (fact) {
    return {
      id: 'star-q1-tech',
      category: 'technical',
      question: engineering
        ? 'Опишите сложную архитектурную задачу или проблему производительности, которую вы успешно решили.'
        : `Опишите профессиональную задачу, в которой вы приняли важное решение и можете показать результат.`,
      starAnswer: {
        situation: 'Контекст ситуации в подтверждённых данных не зафиксирован; уточните его перед встречей.',
        task: 'Задача и критерии успеха в подтверждённых данных не зафиксированы; добавьте их при подготовке.',
        action: fact.statement,
        result: fact.domain === 'outcome'
          ? `Подтверждённый результат из профиля: ${fact.statement}`
          : 'Результат этого действия в профиле не зафиксирован; не называйте его измеренным без подтверждения.',
      },
      usedEvidenceIds: [fact.id],
    };
  }
  const question = engineering
    ? 'Опишите сложную архитектурную задачу или проблему производительности, которую вы успешно решили.'
    : 'Опишите профессиональную задачу, в которой вы приняли важное решение и можете показать результат.';
  return {
    id: 'star-q1-tech',
    category: 'technical',
    question,
    starAnswer: unknownStarAnswer(),
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
        situation: 'Ситуация в подтверждённых данных не зафиксирована; уточните её у себя перед встречей.',
        task: 'Задача и критерии успеха в подтверждённых данных не зафиксированы; добавьте их при подготовке.',
        action: fact.statement,
        result: 'Результат в профиле не зафиксирован; используйте только подтверждённые последствия действия.',
      },
      usedEvidenceIds: [fact.id],
    };
  }
  return {
    id: 'star-q2-behavioral',
    category: 'behavioral',
    question: `Расскажите о ситуации, когда вам пришлось согласовывать сложное решение или координировать команду.`,
    starAnswer: unknownStarAnswer(),
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
        situation: 'Мотивационный контекст кандидата не зафиксирован в профиле.',
        task: 'Уточните, какую задачу этой роли кандидат хочет решать и почему.',
        action: `Подтверждённый факт, который можно связать с ролью: ${fact.statement}`,
        result: 'Результат и личная мотивация не зафиксированы; не выдавайте их за подтверждённые.',
      },
      usedEvidenceIds: [fact.id],
    };
  }
  return {
    id: 'star-q3-motivation',
    category: 'motivation',
    question: `Почему вам интересна позиция «${vacancy.title}» в ${company}?`,
    starAnswer: unknownStarAnswer(),
    usedEvidenceIds: [],
  };
}

function buildCounterQuestions(vacancy: InterviewVacancyTarget): readonly string[] {
  const company = vacancy.company?.trim() || 'компании';
  const engineering = isEngineeringRole(vacancy);
  if (!engineering) {
    return [
      `Какие ключевые цели и критерии успеха стоят перед специалистом на позиции «${vacancy.title}» на первые 3–6 месяцев?`,
      `Как в ${company} устроено взаимодействие этой роли со смежными командами?`,
      'Какие решения специалист принимает самостоятельно, а где требуется согласование?',
      'Какие данные и показатели используются для оценки результата?',
      'Какие следующие шаги процесса и сроки обратной связи?',
      'Какие ситуации в этой роли требуют наибольшей самостоятельности?',
      'Какие ошибки на старте считаются наиболее рискованными?',
      'Какие коллеги и данные помогают принимать решения по этой роли?',
      'Как менялись приоритеты команды за последний период?',
      'Что будет главным признаком успешного прохождения испытательного срока?',
    ];
  }
  return [
    `Какие ключевые цели и критерии успеха стоят перед инженером на позиции «${vacancy.title}» на первые 3-6 месяцев?`,
    `Как в ${company} устроен процесс принятия решений между продуктом и технической экспертизой?`,
    `С какими главными техническими вызовами или ограничениями сталкивается сейчас архитектура сервисов?`,
    `Каковы текущие стандарты инженерного качества: покрытие тестами, автоматизация CI/CD и наблюдаемость в production?`,
    `Как в инженерной культуре ${company} выстроено профессиональное развитие специалистов и обмен опытом?`,
    `Какие инциденты или ограничения сейчас сильнее всего влияют на работу команды ${company}?`,
    `Как принимается решение о компромиссе между сроком поставки и качеством решения?`,
    `Какие данные доступны специалисту для оценки результата на позиции «${vacancy.title}»?`,
    `Какие ожидания от взаимодействия с продуктом, дизайном и бизнесом?`,
    'Что будет главным признаком успешного прохождения испытательного срока?',
  ];
}
