export type OnboardingStage = 'prep' | 'days-30' | 'days-60' | 'days-90';

export type TaskCategory = 'people' | 'strategy' | 'delivery' | 'alignment';

export interface OnboardingTask {
  id: string;
  title: string;
  description: string;
  stage: OnboardingStage;
  completed: boolean;
  category: TaskCategory;
}

export interface OnboardingGoal {
  id: string;
  title: string;
  type: string;
  targetDate?: string;
  status: 'on_track' | 'at_risk' | 'achieved';
}

export interface ExperienceQuantum {
  id: string;
  situation: string;
  action: string;
  result: string;
  date: string;
}

export interface ExecutiveOnboardingState {
  companyName: string;
  roleTitle: string;
  activeStage: OnboardingStage;
  tasks: OnboardingTask[];
  goals: OnboardingGoal[];
  quantums: ExperienceQuantum[];
}

export interface OnboardingProgress {
  overallPercent: number;
  completedCount: number;
  totalCount: number;
  stagePercent: Record<OnboardingStage, number>;
}

export interface SanitizationResult {
  safe: boolean;
  sanitizedText: string;
  warning?: string;
}

const DEFAULT_PREP_TASKS: Omit<OnboardingTask, 'id' | 'completed'>[] = [
  {
    title: 'Аудит условий и ожиданий',
    description: 'Согласовать с нанимающим менеджером критерии успешности испытательного срока.',
    stage: 'prep',
    category: 'alignment',
  },
  {
    title: 'Технический и продуктовый экспресс-анализ',
    description: 'Изучить открытые архитектурные решения, релизные циклы и продукты компании.',
    stage: 'prep',
    category: 'strategy',
  },
  {
    title: 'Карта ключевых лиц',
    description: 'Составить предварительный список руководителей и стейкхолдеров для вводных встреч.',
    stage: 'prep',
    category: 'people',
  },
];

const DEFAULT_DAYS_30_TASKS: Omit<OnboardingTask, 'id' | 'completed'>[] = [
  {
    title: 'Серия встреч 1:1 с командой',
    description: 'Провести вводные беседы со всеми прямыми подчинёнными: боли, ожидания, сильные стороны.',
    stage: 'days-30',
    category: 'people',
  },
  {
    title: 'Диагностика процессов и метрик',
    description: 'Оценить текущий Time-to-Market, частоту релизов и уровень инцидентов.',
    stage: 'days-30',
    category: 'delivery',
  },
  {
    title: 'Сверка ожиданий с руководителем',
    description: 'Уточнить приоритеты первых 30 дней и согласовать первые быстрые победы (quick wins).',
    stage: 'days-30',
    category: 'alignment',
  },
  {
    title: 'Карта рисков и технического долга',
    description: 'Зафиксировать критические уязвимости и узкие места в инфраструктуре или продукте.',
    stage: 'days-30',
    category: 'strategy',
  },
];

const DEFAULT_DAYS_60_TASKS: Omit<OnboardingTask, 'id' | 'completed'>[] = [
  {
    title: 'Реализация первой быстрой победы',
    description: 'Завершить осязаемое улучшение процесса или продукта для подтверждения доверия.',
    stage: 'days-60',
    category: 'delivery',
  },
  {
    title: 'Формирование проекта стратегии',
    description: 'Подготовить драфт дорожной карты развития подразделения на 6–12 месяцев.',
    stage: 'days-60',
    category: 'strategy',
  },
  {
    title: 'Оценка команды и компетенций',
    description: 'Определить кадровые дефициты, перегруженные роли и потребности в найме.',
    stage: 'days-60',
    category: 'people',
  },
  {
    title: 'Промежуточный синк 60 дней',
    description: 'Обсудить прогресс со стейкхолдерами и скорректировать курс при необходимости.',
    stage: 'days-60',
    category: 'alignment',
  },
];

const DEFAULT_DAYS_90_TASKS: Omit<OnboardingTask, 'id' | 'completed'>[] = [
  {
    title: 'Защита дорожной карты',
    description: 'Презентовать стратегию и OKR на следующий год руководству компании.',
    stage: 'days-90',
    category: 'strategy',
  },
  {
    title: 'Итоги испытательного срока',
    description: 'Провести формальный обзор результатов 30-60-90 и зафиксировать прохождение.',
    stage: 'days-90',
    category: 'alignment',
  },
  {
    title: 'Внедрение долгосрочных практик',
    description: 'Закрепить утверждённые регламенты разработки, грейдирования или релизов.',
    stage: 'days-90',
    category: 'delivery',
  },
];

function buildTaskList(): OnboardingTask[] {
  const allTemplates = [
    ...DEFAULT_PREP_TASKS,
    ...DEFAULT_DAYS_30_TASKS,
    ...DEFAULT_DAYS_60_TASKS,
    ...DEFAULT_DAYS_90_TASKS,
  ];

  return allTemplates.map((template, index) => ({
    ...template,
    id: `task-${template.stage}-${index + 1}`,
    completed: false,
  }));
}

export function createDefaultExecutiveOnboarding(
  companyName: string,
  roleTitle: string
): ExecutiveOnboardingState {
  return {
    companyName,
    roleTitle,
    activeStage: 'days-30',
    tasks: buildTaskList(),
    goals: [],
    quantums: [],
  };
}

export function calculateOnboardingProgress(
  state: ExecutiveOnboardingState
): OnboardingProgress {
  const totalCount = state.tasks.length;
  const completedCount = state.tasks.filter((t) => t.completed).length;
  const overallPercent = totalCount === 0 ? 0 : Math.round((completedCount / totalCount) * 100);

  const stages: OnboardingStage[] = ['prep', 'days-30', 'days-60', 'days-90'];
  const stagePercent = stages.reduce<Record<OnboardingStage, number>>((acc, stage) => {
    const stageTasks = state.tasks.filter((t) => t.stage === stage);
    if (stageTasks.length === 0) {
      acc[stage] = 0;
    } else {
      const completed = stageTasks.filter((t) => t.completed).length;
      acc[stage] = Math.round((completed / stageTasks.length) * 100);
    }
    return acc;
  }, { prep: 0, 'days-30': 0, 'days-60': 0, 'days-90': 0 });

  return {
    overallPercent,
    completedCount,
    totalCount,
    stagePercent,
  };
}

export function toggleTask(
  state: ExecutiveOnboardingState,
  taskId: string
): ExecutiveOnboardingState {
  return {
    ...state,
    tasks: state.tasks.map((task) =>
      task.id === taskId ? { ...task, completed: !task.completed } : task
    ),
  };
}

export function addGoal(
  state: ExecutiveOnboardingState,
  goal: {
    title: string;
    type: string;
    targetDate?: string;
    status?: 'on_track' | 'at_risk' | 'achieved';
  }
): ExecutiveOnboardingState {
  const newGoal: OnboardingGoal = {
    id: `goal-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    title: goal.title,
    type: goal.type,
    targetDate: goal.targetDate,
    status: goal.status ?? 'on_track',
  };

  return {
    ...state,
    goals: [...state.goals, newGoal],
  };
}

export function addQuantum(
  state: ExecutiveOnboardingState,
  quantum: {
    situation: string;
    action: string;
    result: string;
    date?: string;
  }
): ExecutiveOnboardingState {
  const newQuantum: ExperienceQuantum = {
    id: `quantum-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    situation: quantum.situation,
    action: quantum.action,
    result: quantum.result,
    date: quantum.date ?? new Date().toISOString().slice(0, 10),
  };

  return {
    ...state,
    quantums: [...state.quantums, newQuantum],
  };
}

const STAGE_ADVICE: Record<OnboardingStage, string[]> = {
  prep: [
    'Сфокусируйтесь на контексте бизнеса: кто основные клиенты и как продукт генерирует ценность.',
    'Не давайте поспешных публичных обещаний до выхода: сначала соберите картину изнутри.',
    'Зафиксируйте список стейкхолдеров первого круга для личных знакомств.',
  ],
  'days-30': [
    'Согласуйте взаимные ожидания с руководителем и проведите 1:1 со всеми ключевыми стейкхолдерами.',
    'Первые 30 дней — режим активного слушания. Не ломайте процессы, не разобравшись в причинах их создания.',
    'Найдите 1–2 небольшие проблемы с быстрым эффектом («quick wins») для первой победы.',
  ],
  'days-60': [
    'Переходите от наблюдений к точечным инициативам и формированию проекта стратегии.',
    'Проверьте первые гипотезы на практике и согласуйте драфт дорожной карты.',
    'Проведите промежуточный синк с руководителем: совпадает ли ваш темп с его ожиданиями.',
  ],
  'days-90': [
    'Защитите долгосрочные цели и дорожную карту на ближайшие кварталы.',
    'Зафиксируйте официальные итоги испытательного срока с чёткими подтверждёнными метриками.',
    'Переведите организационные изменения в статус стандартных операционных процедур.',
  ],
};

export function generateStageAdvice(stage: OnboardingStage, _roleTitle?: string): string[] {
  return STAGE_ADVICE[stage] || [];
}

const SECRET_PATTERNS = [
  /sk-[a-zA-Z0-9_-]{20,}/i,
  /bearer\s+[a-zA-Z0-9._-]{10,}/i,
  /ghp_[a-zA-Z0-9]{20,}/i,
  /aws_secret_access_key/i,
  /-----BEGIN\s+PRIVATE\s+KEY-----/i,
  /password\s*[:=]\s*\S+/i,
];

export function sanitizeWorkplaceInput(text: string): SanitizationResult {
  let sanitized = text;
  let hasSecrets = false;

  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(sanitized)) {
      hasSecrets = true;
      sanitized = sanitized.replace(pattern, '[СКРЫТО]');
    }
  }

  if (hasSecrets) {
    return {
      safe: false,
      sanitizedText: sanitized,
      warning: 'Обнаружены потенциально конфиденциальные данные (ключи, токены или пароли). Они были скрыты.',
    };
  }

  return {
    safe: true,
    sanitizedText: text,
  };
}
